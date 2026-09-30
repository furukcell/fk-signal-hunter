import http from "node:http";
import WebSocket from "ws";

const PORT = Number(process.env.PORT || 3001);
const API = "https://api.binance.com";
const CG_API = "https://api.coingecko.com/api/v3";
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || "";
const QUOTE = "USDT";
const MAX_COINS = 100;
const DEPTH_COINS = 20;
const DEPTH_LEVELS = 20;
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
  const [infoRes, tickerRes, cgRes] = await Promise.all([
    fetch(`${API}/api/v3/exchangeInfo`),
    fetch(`${API}/api/v3/ticker/24hr`),
    fetch(`${CG_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&locale=en`, {
      headers: COINGECKO_API_KEY ? {"x-cg-demo-api-key": COINGECKO_API_KEY} : {}
    })
  ]);

  if (!infoRes.ok || !tickerRes.ok) throw new Error("Binance market discovery failed");
  if (!cgRes.ok) throw new Error("CoinGecko market-cap discovery failed");

  const info = await infoRes.json();
  const tickers = await tickerRes.json();
  const cgCoins = await cgRes.json();

  const allowed = new Map(
    info.symbols
      .filter(s => s.status === "TRADING" && s.quoteAsset === QUOTE && s.isSpotTradingAllowed)
      .map(s => [s.symbol, s])
  );

  const tickerMap = new Map(tickers.map(t => [t.symbol, t]));
  const stableSymbols = new Set(["USDT","USDC","FDUSD","TUSD","DAI","USDE","USDS","USDD","PYUSD"]);

  // CoinGecko supplies the market-cap ranking; Binance supplies the actual tradable USDT pair.
  const candidates = [];
  for (const coin of cgCoins) {
    const symbol = String(coin.symbol || "").toUpperCase();
    if (stableSymbols.has(symbol)) continue;

    const binanceSymbol = symbol + QUOTE;
    if (!allowed.has(binanceSymbol)) continue;

    const ticker = tickerMap.get(binanceSymbol);
    if (!ticker || Number(ticker.quoteVolume) <= 0) continue;

    candidates.push({
      rank: candidates.length + 1,
      marketCapRank: coin.market_cap_rank,
      symbol: binanceSymbol,
      baseAsset: symbol,
      marketCapUsd: Number(coin.market_cap || 0),
      volume24h: Number(ticker.volume || 0),
      quoteVolume24h: Number(ticker.quoteVolume || 0),
      priceChangePct24h: Number(ticker.priceChangePercent || 0)
    });

    if (candidates.length >= MAX_COINS) break;
  }

  universe = candidates;

  for (const item of universe) {
    const m = markets.get(item.symbol) || emptyMarket(item.symbol);
    Object.assign(m, item);
    markets.set(item.symbol, m);
  }

  const keep = new Set(universe.map(x => x.symbol));
  for (const symbol of markets.keys()) if (!keep.has(symbol)) markets.delete(symbol);

  connectStreams();
}
