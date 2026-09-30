import http from "node:http";
import WebSocket from "ws";

const PORT = Number(process.env.PORT || 3001);
const SYMBOL = "btcusdt";
const DEPTH_LEVELS = 20;
const FLOW_WINDOW_MS = 60_000;

const state = {
  symbol: "BTC/USDT",
  bid: null,
  ask: null,
  last: null,
  spreadPct: null,
  buyVolume: 0,
  sellVolume: 0,
  trades: 0,
  lastTradeAt: null,
  connected: false,
  updatedAt: null,
  error: null,
  bids: [],
  asks: [],
  imbalancePct: null,
  score: 0,
  signal: "WAIT",
  reasons: []
};

const flow = [];

function pruneFlow(now = Date.now()) {
  const cutoff = now - FLOW_WINDOW_MS;
  while (flow.length && flow[0].time < cutoff) flow.shift();
}

function resetFlow() {
  flow.length = 0;
  state.buyVolume = 0;
  state.sellVolume = 0;
  state.trades = 0;
}

function updateSignal() {
  const total = state.buyVolume + state.sellVolume;
  const pressure = total > 0 ? (state.buyVolume / total) * 100 : null;
  const bookTotal = state.bids.reduce((s, x) => s + x.qty, 0) + state.asks.reduce((s, x) => s + x.qty, 0);
  const imbalance = bookTotal > 0
    ? ((state.bids.reduce((s, x) => s + x.qty, 0) - state.asks.reduce((s, x) => s + x.qty, 0)) / bookTotal) * 100
    : null;

  state.imbalancePct = imbalance;

  let score = 50;
  const reasons = [];

  if (pressure != null) {
    if (pressure >= 65) { score += 18; reasons.push("Strong executed buy pressure"); }
    else if (pressure >= 55) { score += 9; reasons.push("Positive executed buy pressure"); }
    else if (pressure <= 35) { score -= 18; reasons.push("Strong executed sell pressure"); }
    else if (pressure <= 45) { score -= 9; reasons.push("Negative executed sell pressure"); }
  }

  if (imbalance != null) {
    if (imbalance >= 20) { score += 12; reasons.push("Bid-side book imbalance"); }
    else if (imbalance >= 8) { score += 6; reasons.push("Mild bid-side imbalance"); }
    else if (imbalance <= -20) { score -= 12; reasons.push("Ask-side book imbalance"); }
    else if (imbalance <= -8) { score -= 6; reasons.push("Mild ask-side imbalance"); }
  }

  if (state.spreadPct != null) {
    if (state.spreadPct <= 0.02) { score += 5; reasons.push("Tight spread"); }
    else if (state.spreadPct >= 0.08) { score -= 8; reasons.push("Wide spread"); }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  state.score = score;
  state.reasons = reasons.slice(0, 4);
  state.signal = score >= 82 ? "WATCH" : score >= 70 ? "MONITOR" : "WAIT";
}

function connectMarketStream() {
  const streams = [
    `${SYMBOL}@bookTicker`,
    `${SYMBOL}@depth20@100ms`,
    `${SYMBOL}@trade`
  ].join("/");

  const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

  ws.on("open", () => {
    state.connected = true;
    state.error = null;
  });

  ws.on("message", raw => {
    try {
      const packet = JSON.parse(raw.toString());
      const data = packet.data;
      const now = Date.now();

      if (data.e === "bookTicker") {
        state.bid = Number(data.b);
        state.ask = Number(data.a);
        state.last = state.last ?? Number(data.a);
        state.spreadPct = state.bid > 0 ? ((state.ask - state.bid) / state.bid) * 100 : null;
      }

      if (data.e === "depthUpdate") {
        state.bids = (data.b || []).slice(0, DEPTH_LEVELS).map(([price, qty]) => ({price:Number(price),qty:Number(qty)}));
        state.asks = (data.a || []).slice(0, DEPTH_LEVELS).map(([price, qty]) => ({price:Number(price),qty:Number(qty)}));
      }

      if (data.e === "trade") {
        const qty = Number(data.q);
        state.last = Number(data.p);
        state.trades += 1;

        if (data.m) state.sellVolume += qty;
        else state.buyVolume += qty;

        flow.push({ time: now, qty, buy: !data.m });
        pruneFlow(now);
        state.lastTradeAt = new Date(data.T || now).toISOString();
      }

      state.updatedAt = new Date().toISOString();
      updateSignal();
    } catch {
      state.error = "Invalid market stream payload";
    }
  });

  ws.on("close", () => {
    state.connected = false;
    setTimeout(connectMarketStream, 1500);
  });

  ws.on("error", err => {
    state.connected = false;
    state.error = err.message;
    ws.close();
  });
}

function snapshot() {
  pruneFlow();
  const total = state.buyVolume + state.sellVolume;
  const windowBuy = flow.filter(x => x.buy).reduce((s, x) => s + x.qty, 0);
  const windowSell = flow.filter(x => !x.buy).reduce((s, x) => s + x.qty, 0);
  const windowTotal = windowBuy + windowSell;

  return {
    ...state,
    buyPressurePct: total > 0 ? (state.buyVolume / total) * 100 : null,
    flowVolume: total,
    windowBuyVolume: windowBuy,
    windowSellVolume: windowSell,
    windowBuyPressurePct: windowTotal > 0 ? (windowBuy / windowTotal) * 100 : null,
    bidDepth: state.bids.reduce((s, x) => s + x.qty, 0),
    askDepth: state.asks.reduce((s, x) => s + x.qty, 0)
  };
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.url === "/health") {
    res.writeHead(200, {"Content-Type":"application/json"});
    return res.end(JSON.stringify({ok:true,marketStream:state.connected}));
  }

  if (req.url === "/api/market/btcusdt") {
    res.writeHead(200, {"Content-Type":"application/json"});
    return res.end(JSON.stringify(snapshot()));
  }

  if (req.url === "/api/market/reset-flow" && req.method === "POST") {
    resetFlow();
    res.writeHead(204);
    return res.end();
  }

  res.writeHead(404, {"Content-Type":"application/json"});
  res.end(JSON.stringify({error:"Not found"}));
});

connectMarketStream();
server.listen(PORT, () => console.log(`FK Signal Hunter API listening on :${PORT}`));
