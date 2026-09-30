import http from "node:http";
import WebSocket from "ws";

const PORT = Number(process.env.PORT || 3001);
const API = "https://api.binance.com";
const QUOTE = "USDT";
const MAX_COINS = 100;
const FLOW_WINDOW_MS = 60_000;
const REFRESH_UNIVERSE_MS = 5 * 60_000;

const markets = new Map();
let universe = [];
let socket = null;
let reconnectTimer = null;
let universeTimer = null;

function emptyMarket(symbol) {
  return {
    symbol,
    bid: null, ask: null, last: null, spreadPct: null,
    buyVolume: 0, sellVolume: 0, trades: 0,
    lastTradeAt: null, bids: [], asks: [],
    imbalancePct: null, score: 50, signal: "WAIT", reasons: [],
    volume24h: 0, quoteVolume24h: 0, priceChangePct24h: 0,
    flow: [], updatedAt: null
  };
}

function pruneFlow(m) {
  const cutoff = Date.now() - FLOW_WINDOW_MS;
  while (m.flow.length && m.flow[0].time < cutoff) m.flow.shift();
}

function updateSignal(m) {
  pruneFlow(m);
  const total = m.buyVolume + m.sellVolume;
  const pressure = total > 0 ? (m.buyVolume / total) * 100 : null;
  const bidDepth = m.bids.reduce((s, x) => s + x.qty, 0);
  const askDepth = m.asks.reduce((s, x) => s + x.qty, 0);
  const bookTotal = bidDepth + askDepth;
  m.imbalancePct = bookTotal > 0 ? ((bidDepth - askDepth) / bookTotal) * 100 : null;

  let score = 50;
  const reasons = [];

  if (pressure != null) {
    if (pressure >= 65) { score += 18; reasons.push("Strong executed buy pressure"); }
    else if (pressure >= 55) { score += 9; reasons.push("Positive executed buy pressure"); }
    else if (pressure <= 35) { score -= 18; reasons.push("Strong executed sell pressure"); }
    else if (pressure <= 45) { score -= 9; reasons.push("Negative executed sell pressure"); }
  }

  if (m.imbalancePct != null) {
    if (m.imbalancePct >= 20) { score += 12; reasons.push("Bid-side book imbalance"); }
    else if (m.imbalancePct >= 8) { score += 6; reasons.push("Mild bid-side imbalance"); }
    else if (m.imbalancePct <= -20) { score -= 12; reasons.push("Ask-side book imbalance"); }
    else if (m.imbalancePct <= -8) { score -= 6; reasons.push("Mild ask-side imbalance"); }
  }

  if (m.spreadPct != null) {
    if (m.spreadPct <= 0.02) { score += 5; reasons.push("Tight spread"); }
    else if (m.spreadPct >= 0.08) { score -= 8; reasons.push("Wide spread"); }
  }

  // Liquidity/volume context: high-volume pairs get a small ranking bonus.
  if (m.quoteVolume24h >= 100_000_000) score += 5;
  else if (m.quoteVolume24h >= 25_000_000) score += 3;

  m.score = Math.max(0, Math.min(100, Math.round(score)));
  m.reasons = reasons.slice(0, 4);
  m.signal = m.score >= 82 ? "WATCH" : m.score >= 70 ? "MONITOR" : "WAIT";
}

async function loadUniverse() {
  const [infoRes, tickerRes] = await Promise.all([
    fetch(`${API}/api/v3/exchangeInfo`),
    fetch(`${API}/api/v3/ticker/24hr`)
  ]);
  if (!infoRes.ok || !tickerRes.ok) throw new Error("Binance market discovery failed");

  const info = await infoRes.json();
  const tickers = await tickerRes.json();
  const allowed = new Map(
    info.symbols
      .filter(s => s.status === "TRADING" && s.quoteAsset === QUOTE && s.isSpotTradingAllowed)
      .map(s => [s.symbol, s])
  );

  universe = tickers
    .filter(t => allowed.has(t.symbol) && Number(t.quoteVolume) > 0)
    .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .slice(0, MAX_COINS)
    .map((t, i) => ({
      rank: i + 1,
      symbol: t.symbol,
      volume24h: Number(t.volume),
      quoteVolume24h: Number(t.quoteVolume),
      priceChangePct24h: Number(t.priceChangePercent)
    }));

  for (const item of universe) {
    const m = markets.get(item.symbol) || emptyMarket(item.symbol);
    Object.assign(m, item);
    markets.set(item.symbol, m);
  }

  const keep = new Set(universe.map(x => x.symbol));
  for (const symbol of markets.keys()) if (!keep.has(symbol)) markets.delete(symbol);

  connectStreams();
}

function connectStreams() {
  if (socket) {
    try { socket.close(); } catch {}
    socket = null;
  }

  if (!universe.length) return;

  const streams = universe.flatMap(x => [
    `${x.symbol.toLowerCase()}@bookTicker`,
    `${x.symbol.toLowerCase()}@trade`
  ]).join("/");

  socket = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

  socket.on("open", () => {
    for (const m of markets.values()) m.connected = true;
  });

  socket.on("message", raw => {
    try {
      const packet = JSON.parse(raw.toString());
      const data = packet.data;
      const m = markets.get(data.s);
      if (!m) return;
      const now = Date.now();

      if (data.e === "bookTicker") {
        m.bid = Number(data.b);
        m.ask = Number(data.a);
        m.last = m.last ?? Number(data.a);
        m.spreadPct = m.bid > 0 ? ((m.ask - m.bid) / m.bid) * 100 : null;
      }

      if (data.e === "trade") {
        const qty = Number(data.q);
        m.last = Number(data.p);
        m.trades += 1;
        const buy = !data.m;
        if (buy) m.buyVolume += qty;
        else m.sellVolume += qty;
        m.flow.push({time: now, qty, buy});
        pruneFlow(m);
        m.lastTradeAt = new Date(data.T || now).toISOString();
      }

      m.updatedAt = new Date().toISOString();
      updateSignal(m);
    } catch {
      // Ignore malformed packets; the next stream packet remains usable.
    }
  });

  socket.on("close", () => {
    for (const m of markets.values()) m.connected = false;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectStreams, 1500);
  });

  socket.on("error", () => {
    try { socket.close(); } catch {}
  });
}

async function refreshUniverse() {
  try {
    await loadUniverse();
    console.log(`Scanner universe: ${universe.length} USDT spot pairs`);
  } catch (err) {
    console.error(err.message);
    clearTimeout(universeTimer);
    universeTimer = setTimeout(refreshUniverse, 5000);
  }
}

function snapshot(m) {
  pruneFlow(m);
  const total = m.buyVolume + m.sellVolume;
  const windowBuy = m.flow.filter(x => x.buy).reduce((s, x) => s + x.qty, 0);
  const windowSell = m.flow.filter(x => !x.buy).reduce((s, x) => s + x.qty, 0);
  const windowTotal = windowBuy + windowSell;

  return {
    ...m,
    flow: undefined,
    buyPressurePct: total > 0 ? (m.buyVolume / total) * 100 : null,
    flowVolume: total,
    windowBuyVolume: windowBuy,
    windowSellVolume: windowSell,
    windowBuyPressurePct: windowTotal > 0 ? (windowBuy / windowTotal) * 100 : null
  };
}

function scannerSnapshot() {
  return universe.map((u) => snapshot(markets.get(u.symbol) || emptyMarket(u.symbol)))
    .sort((a, b) => b.score - a.score);
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/health") {
    res.writeHead(200);
    return res.end(JSON.stringify({
      ok: true,
      universeSize: universe.length,
      streamConnected: Boolean(socket && socket.readyState === WebSocket.OPEN)
    }));
  }

  if (req.url === "/api/market/scanner") {
    res.writeHead(200);
    return res.end(JSON.stringify({
      universeSize: universe.length,
      quote: QUOTE,
      updatedAt: new Date().toISOString(),
      markets: scannerSnapshot()
    }));
  }

  if (req.url === "/api/market/btcusdt") {
    const btc = markets.get("BTCUSDT");
    res.writeHead(200);
    return res.end(JSON.stringify(btc ? snapshot(btc) : {error:"BTCUSDT not in scanner universe"}));
  }

  if (req.url === "/api/market/reset-flow" && req.method === "POST") {
    for (const m of markets.values()) {
      m.buyVolume = 0; m.sellVolume = 0; m.trades = 0; m.flow = [];
    }
    res.writeHead(204);
    return res.end();
  }

  res.writeHead(404);
  res.end(JSON.stringify({error:"Not found"}));
});

server.listen(PORT, () => console.log(`FK Signal Hunter API listening on :${PORT}`));

refreshUniverse();
setInterval(refreshUniverse, REFRESH_UNIVERSE_MS);
