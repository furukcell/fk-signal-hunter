import http from "node:http";
import WebSocket from "ws";
import { CrossExchangeHub, EXCHANGE_NAMES } from "./exchangeHub.js";
import { PaperEngine } from "./paperEngine.js";
import { buildOpportunity } from "./signalEngine.js";
import { runBacktest } from "./backtestEngine.js";

const PORT = Number(process.env.PORT || 3001);
const API = "https://api.binance.com";
const CG_API = "https://api.coingecko.com/api/v3";
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || "";
const QUOTE = "USDT";
const MAX_COINS = 100;
const FLOW_WINDOW_MS = 60_000;
const REFRESH_UNIVERSE_MS = 5 * 60_000;

const markets = new Map();
const exchangeFlows = new Map();
let universe = [];
let hub = null;
let universeTimer = null;
const paper = new PaperEngine({ initialBalance: 1000, positionPct: 0.15, tpPct: 0.02, slPct: 0.008, maxOpenPositions: 2 });

function emptyMarket(symbol) {
  return {
    symbol, baseAsset: symbol.replace(/USDT$/, ""), quoteAsset: "USDT",
    bid: null, ask: null, last: null, spreadPct: null,
    buyVolume: 0, sellVolume: 0, trades: 0, flowVolume: 0,
    buyPressurePct: null, lastTradeAt: null,
    bids: [], asks: [], imbalancePct: null,
    score: 50, signal: "WAIT", reasons: [],
    volume24h: 0, quoteVolume24h: 0, priceChangePct24h: 0,
    exchangeCount: 0, buyConsensus: 0, priceDispersionPct: null,
    exchangeData: {}, flow: [], updatedAt: null
  };
}

function prune(m) {
  const cutoff = Date.now() - FLOW_WINDOW_MS;
  while (m.flow?.length && m.flow[0].time < cutoff) m.flow.shift();
}

function updateSignal(m) {
  prune(m);
  const total = m.buyVolume + m.sellVolume;
  m.flowVolume = total;
  m.buyPressurePct = total > 0 ? (m.buyVolume / total) * 100 : null;

  const bidDepth = m.bids.reduce((s, x) => s + x.qty, 0);
  const askDepth = m.asks.reduce((s, x) => s + x.qty, 0);
  const bookTotal = bidDepth + askDepth;
  m.imbalancePct = bookTotal > 0 ? ((bidDepth - askDepth) / bookTotal) * 100 : null;

  let score = 50;
  const reasons = [];

  if (m.buyPressurePct != null) {
    if (m.buyPressurePct >= 65) { score += 18; reasons.push("Strong executed buy pressure"); }
    else if (m.buyPressurePct >= 55) { score += 9; reasons.push("Positive executed buy pressure"); }
    else if (m.buyPressurePct <= 35) { score -= 18; reasons.push("Strong executed sell pressure"); }
    else if (m.buyPressurePct <= 45) { score -= 9; reasons.push("Negative executed sell pressure"); }
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

  if (m.quoteVolume24h >= 100_000_000) score += 5;
  else if (m.quoteVolume24h >= 25_000_000) score += 3;

  if (m.exchangeCount >= 6) { score += 4; reasons.push("Multi-exchange confirmation"); }
  else if (m.exchangeCount >= 3) { score += 2; }

  if (m.buyConsensus >= 0.7) { score += 6; reasons.push("Cross-exchange buy consensus"); }
  else if (m.buyConsensus <= 0.3) { score -= 6; reasons.push("Cross-exchange sell consensus"); }

  if (m.priceDispersionPct != null && m.priceDispersionPct <= 0.15) score += 2;
  if (m.priceDispersionPct != null && m.priceDispersionPct >= 1) score -= 4;

  m.score = Math.max(0, Math.min(100, Math.round(score)));
  m.reasons = reasons.slice(0, 5);
  m.signal = m.score >= 82 ? "WATCH" : m.score >= 70 ? "MONITOR" : "WAIT";
}

function ensureMarket(base) {
  const symbol = base + "USDT";
  const m = markets.get(symbol) || emptyMarket(symbol);
  markets.set(symbol, m);
  return m;
}

function handleExchangeEvent(event) {
  const m = ensureMarket(event.baseAsset);
  const previous = m.exchangeData[event.exchange] || {};
  m.exchangeData[event.exchange] = { ...previous, ...event };

  if (event.source === "book") {
    if (event.bid != null) m.bid = event.bid;
    if (event.ask != null) m.ask = event.ask;
    if (event.price != null) m.last = event.price;
    if (event.spreadPct != null) m.spreadPct = event.spreadPct;
    if (event.bids?.length) m.bids = event.bids;
    if (event.asks?.length) m.asks = event.asks;
  } else if (event.source === "trade") {
    m.last = event.price ?? m.last;
    m.lastTradeAt = event.ts;
    m.trades += 1;
    const quoteQty = Number(event.quoteQty || 0);
    if (event.side === "buy") m.buyVolume += quoteQty;
    if (event.side === "sell") m.sellVolume += quoteQty;
    m.flow.push({ time: Date.now(), exchange: event.exchange, side: event.side, quoteQty });
  }

  const venues = Object.values(m.exchangeData).filter(x => x.price != null || (x.bid != null && x.ask != null));
  m.exchangeCount = venues.length;

  const comparable = venues.filter(x => x.quoteAsset === "USDT");
  const mids = comparable.map(x => {
    if (x.price != null) return Number(x.price);
    if (x.bid != null && x.ask != null) return (Number(x.bid) + Number(x.ask)) / 2;
    return null;
  }).filter(Number.isFinite);

  if (mids.length >= 2) {
    const min = Math.min(...mids);
    const max = Math.max(...mids);
    const avg = mids.reduce((a,b) => a+b, 0) / mids.length;
    m.priceDispersionPct = avg > 0 ? ((max - min) / avg) * 100 : null;
  }

  const directional = comparable.filter(x => x.side === "buy" || x.side === "sell");
  m.buyConsensus = directional.length
    ? directional.filter(x => x.side === "buy").length / directional.length
    : 0;

  const usdt = m.exchangeData.binance;
  if (usdt) {
    if (usdt.bid != null) m.bid = usdt.bid;
    if (usdt.ask != null) m.ask = usdt.ask;
    if (usdt.price != null) m.last = usdt.price;
    if (usdt.spreadPct != null) m.spreadPct = usdt.spreadPct;
  }

  updateSignal(m);

  const opportunity = buildOpportunity(m);
  m.opportunity = opportunity;

  if (event.quoteAsset === "USDT" && event.price != null) {
    const closed = paper.update(m.symbol, Number(event.price), event.ts);
    if (closed) m.lastPaperTrade = closed;
  }

  if (
    opportunity?.actionable &&
    opportunity.buyConsensus >= 0.7 &&
    opportunity.bestBuy &&
    !paper.positions.has(m.symbol)
  ) {
    const opened = paper.open({
      symbol: m.symbol,
      exchange: opportunity.bestBuy.exchange,
      price: opportunity.bestBuy.ask,
      spreadPct: m.spreadPct || 0,
      score: m.score,
      timestamp: event.ts
    });
    if (opened.opened) m.lastPaperEntry = opened.position;
  }
}

