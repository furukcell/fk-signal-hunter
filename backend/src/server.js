import http from "node:http";
import WebSocket from "ws";
import { CrossExchangeHub, EXCHANGE_NAMES } from "./exchangeHub.js";
import { PaperEngine } from "./paperEngine.js";
import { buildOpportunity } from "./signalEngine.js";
import { runBacktest } from "./backtestEngine.js";
import { runWalkForward } from "./walkForwardEngine.js";
import { HistoricalCollector } from "./historicalCollector.js";
import { readHistoricalRows, historicalSummary } from "./historicalLoader.js";

const PORT = Number(process.env.PORT || 3001);
const API = "https://api.binance.com";
const CG_API = "https://api.coingecko.com/api/v3";
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || "";
const QUOTE = "USDT";
const MAX_COINS = 100;
const FLOW_WINDOW_MS = 60_000;
const MOMENTUM_WINDOW_MS = 60_000;
const VOLUME_BASELINE_WINDOW_MS = 5 * 60_000;
const REFRESH_UNIVERSE_MS = 5 * 60_000;

const markets = new Map();
const exchangeFlows = new Map();
let universe = [];
let hub = null;
let universeTimer = null;
const paper = new PaperEngine({ initialBalance: 1000, positionPct: 0.15, tpPct: 0.02, slPct: 0.008, maxOpenPositions: 2 });
const historical = new HistoricalCollector({ intervalMs: Number(process.env.HISTORICAL_INTERVAL_MS || 5000) });

function emptyMarket(symbol) {
  return {
    symbol, baseAsset: symbol.replace(/USDT$/, ""), quoteAsset: "USDT",
    bid: null, ask: null, last: null, spreadPct: null,
    buyVolume: 0, sellVolume: 0, trades: 0, flowVolume: 0,
    buyPressurePct: null, lastTradeAt: null,
    bids: [], asks: [], imbalancePct: null, weightedImbalancePct: null,
    largeBidRatio: 0, largeAskRatio: 0,
    momentumPct1m: null, volumeRate1m: 0, volumeRateBaseline: 0, volumeAnomaly: 0,
    score: 50, signal: "WAIT", reasons: [],
    volume24h: 0, quoteVolume24h: 0, priceChangePct24h: 0,
    exchangeCount: 0, activeExchangeCount: 0, staleExchangeCount: 0, buyConsensus: 0, priceDispersionPct: null,
    exchangeData: {}, flow: [], priceHistory: [], bookSnapshots: [],
    persistencePct: null, bidPersistencePct: null, askPersistencePct: null,
    bookPullRatio: 0, bookReplenishmentRatio: 0,
    sellAbsorption: 0, buyAbsorption: 0, absorptionSignal: "NONE", updatedAt: null
  };
}

function prune(m) {
  const cutoff = Date.now() - VOLUME_BASELINE_WINDOW_MS;
  while (m.flow?.length && m.flow[0].time < cutoff) m.flow.shift();
}

function calculateFlowFeatures(m) {
  const now = Date.now();
  const recentCutoff = now - FLOW_WINDOW_MS;
  const momentumCutoff = now - MOMENTUM_WINDOW_MS;

  const recent = m.flow.filter(x => x.time >= recentCutoff && Number(x.quoteQty) > 0);
  const baseline = m.flow.filter(x => x.time < recentCutoff && x.time >= now - VOLUME_BASELINE_WINDOW_MS);
  const recentVolume = recent.reduce((sum, x) => sum + Number(x.quoteQty), 0);
  const baselineVolume = baseline.reduce((sum, x) => sum + Number(x.quoteQty), 0);

  m.volumeRate1m = recentVolume;
  m.volumeRateBaseline = baselineVolume / 4;
  m.volumeAnomaly = m.volumeRateBaseline > 0
    ? recentVolume / m.volumeRateBaseline
    : recentVolume > 0 ? 1 : 0;

  const recentPrices = m.priceHistory.filter(x => x.time >= momentumCutoff && Number(x.price) > 0);
  if (recentPrices.length >= 2) {
    const first = recentPrices[0].price;
    const last = recentPrices[recentPrices.length - 1].price;
    m.momentumPct1m = first > 0 ? ((last - first) / first) * 100 : null;
  } else {
    m.momentumPct1m = null;
  }
}

function calculateBookFeatures(m) {
  const bid = Number(m.bid);
  const ask = Number(m.ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
    m.imbalancePct = null;
    m.weightedImbalancePct = null;
    m.largeBidRatio = 0;
    m.largeAskRatio = 0;
    return;
  }

  const mid = (bid + ask) / 2;
  const normalizeLevels = levels => (levels || [])
    .map(level => ({
      price: Number(level.price),
      qty: Number(level.qty)
    }))
    .filter(x => x.price > 0 && x.qty > 0);

  const bids = normalizeLevels(m.bids);
  const asks = normalizeLevels(m.asks);
  const maxDistancePct = 0.50;

  const weight = price => {
    const distancePct = Math.abs(price - mid) / mid * 100;
    if (distancePct > maxDistancePct) return 0;
    return Math.max(0.1, 1 - distancePct / maxDistancePct);
  };

  const weightedBid = bids.reduce((sum, x) => sum + x.qty * weight(x.price), 0);
  const weightedAsk = asks.reduce((sum, x) => sum + x.qty * weight(x.price), 0);
  const weightedTotal = weightedBid + weightedAsk;

  const rawBid = bids.reduce((sum, x) => sum + x.qty, 0);
  const rawAsk = asks.reduce((sum, x) => sum + x.qty, 0);
  const rawTotal = rawBid + rawAsk;

  m.imbalancePct = rawTotal > 0 ? ((rawBid - rawAsk) / rawTotal) * 100 : null;
  m.weightedImbalancePct = weightedTotal > 0
    ? ((weightedBid - weightedAsk) / weightedTotal) * 100
    : null;

  const nearBids = bids.filter(x => Math.abs(x.price - mid) / mid * 100 <= maxDistancePct);
  const nearAsks = asks.filter(x => Math.abs(x.price - mid) / mid * 100 <= maxDistancePct);
  const bidNotional = nearBids.reduce((sum, x) => sum + x.price * x.qty, 0);
  const askNotional = nearAsks.reduce((sum, x) => sum + x.price * x.qty, 0);
  const totalNotional = bidNotional + askNotional;

  // A "large" level must represent at least 8% of the visible near-book notional.
  const largeThreshold = totalNotional > 0 ? totalNotional * 0.08 : Infinity;
  const largeBidNotional = nearBids
    .filter(x => x.price * x.qty >= largeThreshold)
    .reduce((sum, x) => sum + x.price * x.qty, 0);
  const largeAskNotional = nearAsks
    .filter(x => x.price * x.qty >= largeThreshold)
    .reduce((sum, x) => sum + x.price * x.qty, 0);

  m.largeBidRatio = totalNotional > 0 ? largeBidNotional / totalNotional : 0;
  m.largeAskRatio = totalNotional > 0 ? largeAskNotional / totalNotional : 0;
}

function calculateBookPersistence(m) {
  const snapshots = m.bookSnapshots || [];
  if (snapshots.length < 2) {
    m.persistencePct = null;
    m.bidPersistencePct = null;
    m.askPersistencePct = null;
    m.bookPullRatio = 0;
    m.bookReplenishmentRatio = 0;
    return;
  }

  const now = Date.now();
  const recent = snapshots.filter(x => now - x.time <= FLOW_WINDOW_MS);
  if (recent.length < 2) return;

  const compare = (side, thresholdPct = 0.15) => {
    let comparable = 0;
    let persistent = 0;
    let pulls = 0;
    let replenishments = 0;

    for (let i = 1; i < recent.length; i++) {
      const previous = recent[i - 1][side];
      const current = recent[i][side];
      if (!previous.length || !current.length) continue;

      const prevMap = new Map(previous.map(x => [Number(x.price), Number(x.qty)]));
      const currMap = new Map(current.map(x => [Number(x.price), Number(x.qty)]));

      for (const [price, prevQty] of prevMap) {
        const currQty = currMap.get(price) || 0;
        const change = prevQty > 0 ? (currQty - prevQty) / prevQty : 0;
        if (Math.abs(change) <= thresholdPct) persistent++;
        else if (change < -thresholdPct) pulls++;
        comparable++;
      }

      for (const [price, currQty] of currMap) {
        const prevQty = prevMap.get(price) || 0;
        if (prevQty > 0 && currQty > prevQty * (1 + thresholdPct)) replenishments++;
      }
    }

    return {
      persistence: comparable ? persistent / comparable : 0,
      pulls,
      replenishments
    };
  };

  const bid = compare("bids");
  const ask = compare("asks");
  const totalComparable = bid.pulls + ask.pulls + bid.replenishments + ask.replenishments;

  m.bidPersistencePct = bid.persistence * 100;
  m.askPersistencePct = ask.persistence * 100;
  m.persistencePct = ((bid.persistence + ask.persistence) / 2) * 100;
  m.bookPullRatio = totalComparable
    ? (bid.pulls + ask.pulls) / totalComparable
    : 0;
  m.bookReplenishmentRatio = totalComparable
    ? (bid.replenishments + ask.replenishments) / totalComparable
    : 0;
}

function calculateAbsorption(m) {
  const now = Date.now();
  const windowStart = now - FLOW_WINDOW_MS;
  const recent = m.flow.filter(x => x.time >= windowStart && Number(x.quoteQty) > 0);

  const buyVolume = recent
    .filter(x => x.side === "buy")
    .reduce((sum, x) => sum + Number(x.quoteQty), 0);
  const sellVolume = recent
    .filter(x => x.side === "sell")
    .reduce((sum, x) => sum + Number(x.quoteQty), 0);
  const totalVolume = buyVolume + sellVolume;

  const history = m.priceHistory.filter(x => x.time >= windowStart && Number(x.price) > 0);
  if (totalVolume <= 0 || history.length < 2) {
    m.buyAbsorption = 0;
    m.sellAbsorption = 0;
    m.absorptionSignal = "NONE";
    return;
  }

  const firstPrice = history[0].price;
  const lastPrice = history[history.length - 1].price;
  const priceMovePct = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

  const pressure = totalVolume > 0
    ? (buyVolume - sellVolume) / totalVolume
    : 0;

  // Strong selling with little downward movement = bid-side absorption.
  const sellPressure = Math.max(0, -pressure);
  const buyPressure = Math.max(0, pressure);
  const downMove = Math.max(0, -priceMovePct);
  const upMove = Math.max(0, priceMovePct);

  const sellAbsorptionBase = sellPressure >= 0.15 && downMove <= 0.12;
  const buyAbsorptionBase = buyPressure >= 0.15 && upMove <= 0.12;

  const bidSupport = Number(m.bidPersistencePct || 0) / 100;
  const askSupport = Number(m.askPersistencePct || 0) / 100;

  m.sellAbsorption = sellAbsorptionBase
    ? Math.min(1, sellPressure * 1.5 + bidSupport * 0.5)
    : 0;
  m.buyAbsorption = buyAbsorptionBase
    ? Math.min(1, buyPressure * 1.5 + askSupport * 0.5)
    : 0;

  if (m.sellAbsorption >= 0.35 && m.sellAbsorption > m.buyAbsorption) {
    m.absorptionSignal = "SELL_ABSORBED";
  } else if (m.buyAbsorption >= 0.35 && m.buyAbsorption > m.sellAbsorption) {
    m.absorptionSignal = "BUY_ABSORBED";
  } else {
    m.absorptionSignal = "NONE";
  }
}

function updateSignal(m) {
  prune(m);
  const recentFlow = m.flow.filter(x => Number(x.quoteQty) > 0);
  const recentBuy = recentFlow
    .filter(x => x.side === "buy")
    .reduce((sum, x) => sum + Number(x.quoteQty), 0);
  const recentSell = recentFlow
    .filter(x => x.side === "sell")
    .reduce((sum, x) => sum + Number(x.quoteQty), 0);
  const total = recentBuy + recentSell;
  m.buyVolume = recentBuy;
  m.sellVolume = recentSell;
  m.flowVolume = total;
  calculateFlowFeatures(m);
  m.buyPressurePct = total > 0 ? (recentBuy / total) * 100 : null;

  calculateBookFeatures(m);
  calculateBookPersistence(m);
  calculateAbsorption(m);

  let score = 50;
  const reasons = [];

  if (m.buyPressurePct != null) {
    if (m.buyPressurePct >= 65) { score += 18; reasons.push("Strong executed buy pressure"); }
    else if (m.buyPressurePct >= 55) { score += 9; reasons.push("Positive executed buy pressure"); }
    else if (m.buyPressurePct <= 35) { score -= 18; reasons.push("Strong executed sell pressure"); }
    else if (m.buyPressurePct <= 45) { score -= 9; reasons.push("Negative executed sell pressure"); }
  }

  if (m.weightedImbalancePct != null) {
    if (m.weightedImbalancePct >= 20) { score += 12; reasons.push("Near-book bid imbalance"); }
    else if (m.weightedImbalancePct >= 8) { score += 6; reasons.push("Near-book bid pressure"); }
    else if (m.weightedImbalancePct <= -20) { score -= 12; reasons.push("Near-book ask imbalance"); }
    else if (m.weightedImbalancePct <= -8) { score -= 6; reasons.push("Near-book ask pressure"); }
  }

  if (m.largeBidRatio >= 0.08 && m.largeBidRatio > m.largeAskRatio) {
    score += 4;
    reasons.push("Large bid liquidity");
  } else if (m.largeAskRatio >= 0.08 && m.largeAskRatio > m.largeBidRatio) {
    score -= 4;
    reasons.push("Large ask liquidity");
  }

  if (m.bidPersistencePct != null && m.askPersistencePct != null) {
    if (m.bidPersistencePct >= 65 && m.bidPersistencePct > m.askPersistencePct + 10) {
      score += 6;
      reasons.push("Persistent bid liquidity");
    } else if (m.askPersistencePct >= 65 && m.askPersistencePct > m.bidPersistencePct + 10) {
      score -= 6;
      reasons.push("Persistent ask liquidity");
    }

    if (m.bookPullRatio >= 0.45) {
      score -= 5;
      reasons.push("High order-book pull activity");
    }

    if (m.bookReplenishmentRatio >= 0.20 && m.bidPersistencePct > m.askPersistencePct) {
      score += 3;
      reasons.push("Bid replenishment");
    }
  }

  if (m.absorptionSignal === "SELL_ABSORBED") {
    score += 10;
    reasons.push("Sell pressure absorbed by bids");
  } else if (m.absorptionSignal === "BUY_ABSORBED") {
    score -= 6;
    reasons.push("Buy pressure absorbed by asks");
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

  if (m.volumeAnomaly >= 2.5) { score += 10; reasons.push("High 1m volume anomaly"); }
  else if (m.volumeAnomaly >= 1.5) { score += 5; reasons.push("Elevated 1m volume"); }

  if (m.momentumPct1m != null) {
    if (m.momentumPct1m >= 0.35) { score += 8; reasons.push("Positive 1m momentum"); }
    else if (m.momentumPct1m >= 0.15) score += 4;
    else if (m.momentumPct1m <= -0.35) { score -= 8; reasons.push("Negative 1m momentum"); }
    else if (m.momentumPct1m <= -0.15) score -= 4;
  }

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
    if (event.bids?.length || event.asks?.length) {
      m.bookSnapshots.push({
        time: Number(event.ts) || Date.now(),
        bids: event.bids?.slice(0, 20) || m.bids.slice(0, 20),
        asks: event.asks?.slice(0, 20) || m.asks.slice(0, 20)
      });
      const cutoff = Date.now() - FLOW_WINDOW_MS;
      while (m.bookSnapshots.length && m.bookSnapshots[0].time < cutoff) {
        m.bookSnapshots.shift();
      }
    }
  } else if (event.source === "trade") {
    m.last = event.price ?? m.last;
    m.lastTradeAt = event.ts;
    m.trades += 1;
    const quoteQty = Number(event.quoteQty || 0);
    if (event.side === "buy") m.buyVolume += quoteQty;
    if (event.side === "sell") m.sellVolume += quoteQty;
    const tradeTime = Number(event.ts) || Date.now();
    m.flow.push({ time: tradeTime, exchange: event.exchange, side: event.side, quoteQty });
    if (Number(event.price) > 0) {
      m.priceHistory.push({ time: tradeTime, price: Number(event.price) });
      if (m.priceHistory.length > 5000) m.priceHistory.splice(0, m.priceHistory.length - 5000);
    }
  }

  const now = Date.now();
  const venues = Object.values(m.exchangeData).filter(x => x.price != null || (x.bid != null && x.ask != null));
  const activeVenues = venues.filter(x => Number(x.updatedAt || 0) > 0 && now - Number(x.updatedAt) <= 30_000);
  m.exchangeCount = venues.length;
  m.activeExchangeCount = activeVenues.length;
  m.staleExchangeCount = Math.max(0, venues.length - activeVenues.length);

  const comparable = activeVenues.filter(x => x.quoteAsset === "USDT");
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

  const usdtExchanges = new Set(comparable.map(x => x.exchange));
  const comparableFlow = m.flow.filter(x =>
    usdtExchanges.has(x.exchange) &&
    (x.side === "buy" || x.side === "sell") &&
    Number(x.quoteQty) > 0
  );
  const flowBuy = comparableFlow
    .filter(x => x.side === "buy")
    .reduce((sum, x) => sum + Number(x.quoteQty), 0);
  const flowSell = comparableFlow
    .filter(x => x.side === "sell")
    .reduce((sum, x) => sum + Number(x.quoteQty), 0);
  const flowTotal = flowBuy + flowSell;
  m.buyConsensus = flowTotal > 0 ? flowBuy / flowTotal : 0;

  const usdt = m.exchangeData.binance;
  if (usdt && Number(usdt.updatedAt || 0) > 0 && now - Number(usdt.updatedAt) <= 30_000) {
    if (usdt.bid != null) m.bid = usdt.bid;
    if (usdt.ask != null) m.ask = usdt.ask;
    if (usdt.price != null) m.last = usdt.price;
    if (usdt.spreadPct != null) m.spreadPct = usdt.spreadPct;
  }

  updateSignal(m);

  const opportunity = buildOpportunity(m);
  if (opportunity && m.activeExchangeCount < 3) {
    opportunity.actionable = false;
    opportunity.inactiveExchangeCount = m.staleExchangeCount;
  }
  m.opportunity = opportunity;

  if (event.quoteAsset === "USDT" && event.price != null) {
    const position = paper.positions.get(m.symbol);
    const positionBook = position
      ? (m.exchangeData[position.exchange] || {})
      : {};
    const closed = paper.update(m.symbol, Number(event.price), event.ts, {
      bids: positionBook.bids || m.bids,
      asks: positionBook.asks || m.asks
    });
    if (closed) m.lastPaperTrade = closed;
  }

  if (
    opportunity?.actionable &&
    opportunity.buyConsensus >= 0.7 &&
    opportunity.bestBuy &&
    !paper.positions.has(m.symbol) &&
    m.activeExchangeCount >= 3
  ) {
    const buyVenue = m.exchangeData[opportunity.bestBuy.exchange] || {};
    const opened = paper.open({
      symbol: m.symbol,
      exchange: opportunity.bestBuy.exchange,
      price: opportunity.bestBuy.ask,
      spreadPct: m.spreadPct || 0,
      score: m.score,
      bids: buyVenue.bids || [],
      asks: buyVenue.asks || [],
      timestamp: event.ts
    });
    if (opened.opened) m.lastPaperEntry = opened.position;
  }
}

\n\nasync function loadUniverse() {
  const [infoRes, tickerRes, cgRes] = await Promise.all([
    fetch(`${API}/api/v3/exchangeInfo`),
    fetch(`${API}/api/v3/ticker/24hr`),
    fetch(`${CG_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&locale=en`, {
      headers: COINGECKO_API_KEY ? { "x-cg-demo-api-key": COINGECKO_API_KEY } : {}
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
  const stableSymbols = new Set(["USDT", "USDC", "FDUSD", "TUSD", "DAI", "USDE", "USDS", "USDD", "PYUSD"]);
  const candidates = [];

  for (const coin of cgCoins) {
    const symbol = String(coin.symbol || "").toUpperCase();
    if (!symbol || stableSymbols.has(symbol)) continue;

    const binanceSymbol = symbol + QUOTE;
    if (!allowed.has(binanceSymbol)) continue;

    const ticker = tickerMap.get(binanceSymbol);
    if (!ticker || Number(ticker.quoteVolume) <= 0) continue;

    candidates.push({
      rank: candidates.length + 1,
      marketCapRank: Number(coin.market_cap_rank || 0),
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

  for (const [symbol, m] of markets) {
    if (!universe.some(x => x.symbol === symbol)) markets.delete(symbol);
  }

  const bases = universe.map(x => x.baseAsset);
  if (!hub) {
    hub = new CrossExchangeHub({ bases, onEvent: handleExchangeEvent });
    hub.start();
  } else {
    hub.setBases(bases);
  }
}

function marketScanner() {
  return universe.map(item => {
    const m = markets.get(item.symbol) || emptyMarket(item.symbol);
    return {
      ...m,
      symbol: item.symbol,
      baseAsset: item.baseAsset,
      quoteAsset: QUOTE,
      marketCapRank: item.marketCapRank,
      marketCapUsd: item.marketCapUsd,
      volume24h: item.volume24h,
      quoteVolume24h: item.quoteVolume24h,
      priceChangePct24h: item.priceChangePct24h,
      exchangeCoverage: EXCHANGE_NAMES.filter(exchange => Boolean(m.exchangeData?.[exchange])).length
    };
  });
}

function json(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function handleRoute(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }

  if (req.method === "GET" && pathname === "/health") {
    return json(res, 200, {
      ok: true,
      universe: universe.length,
      exchanges: EXCHANGE_NAMES,
      historical: historical.snapshot()
    });
  }

  if (req.method === "GET" && pathname === "/api/market/scanner") {
    return json(res, 200, { universe, markets: marketScanner() });
  }

  if (req.method === "GET" && pathname === "/api/market/exchanges") {
    return json(res, 200, hub?.getStatus?.() || {});
  }

  if (req.method === "GET" && pathname === "/api/data-health") {
    const exchangeStatus = hub?.getStatus?.() || {};
    const rows = Object.values(exchangeStatus);
    const liveExchanges = rows.filter(x => x.status === "live").length;
    const healthyExchanges = rows.filter(x => x.coveragePct >= 80).length;
    const totalActiveFeeds = rows.reduce((sum, x) => sum + Number(x.activeFeeds || 0), 0);
    const totalExpectedFeeds = rows.reduce((sum, x) => sum + Number(x.expectedFeeds || 0), 0);
    const marketRows = marketScanner();
    const coveredMarkets = marketRows.filter(m => Number(m.exchangeCount || 0) >= 3).length;
    const historical = await historicalSummary(
      process.env.HISTORICAL_DATA_DIR || "./data/historical"
    );

    return json(res, 200, {
      universe: universe.length,
      marketsTracked: marketRows.length,
      marketsWith3PlusExchanges: coveredMarkets,
      marketCoveragePct: marketRows.length ? (coveredMarkets / marketRows.length) * 100 : 0,
      liveExchanges,
      healthyExchanges,
      totalActiveFeeds,
      totalExpectedFeeds,
      feedCoveragePct: totalExpectedFeeds ? (totalActiveFeeds / totalExpectedFeeds) * 100 : 0,
      historical,
      paper: {
        equity: paper.balance + [...paper.positions.values()].reduce((sum, p) => sum + Number(p.quantity || 0) * Number(p.lastPrice || p.entryPrice || 0), 0),
        returnPct: paper.initialBalance ? ((paper.balance - paper.initialBalance) / paper.initialBalance) * 100 : 0,
        openPositions: paper.positions.size,
        maxOpenPositions: paper.maxOpenPositions
      },
      exchanges: exchangeStatus
    });
  }

  if (req.method === "GET" && pathname === "/api/market/btcusdt") {
    const m = markets.get("BTCUSDT") || emptyMarket("BTCUSDT");
    return json(res, 200, m);
  }

  if (req.method === "POST" && pathname === "/api/market/reset-flow") {
    for (const m of markets.values()) {
      m.flow = [];
      m.priceHistory = [];
      m.bookSnapshots = [];
      m.buyVolume = 0;
      m.sellVolume = 0;
      m.flowVolume = 0;
      m.buyPressurePct = null;
      m.volumeRate1m = 0;
      m.volumeRateBaseline = 0;
      m.volumeAnomaly = 0;
      m.momentumPct1m = null;
    }
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && pathname === "/api/signals") {
    return json(res, 200, marketScanner()
      .filter(m => m.score >= 70)
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, 50));
  }

  if (req.method === "GET" && pathname === "/api/paper") {
    return json(res, 200, paper.snapshot());
  }

  if (req.method === "POST" && pathname === "/api/paper/reset") {
    for (const position of paper.positions.values()) {
      // Reset is an explicit paper-only reset; open positions are discarded.
      void position;
    }
    paper.positions.clear();
    paper.trades = [];
    paper.balance = paper.initialBalance;
    paper.dayStartBalance = paper.balance;
    return json(res, 200, paper.snapshot());
  }

  if (req.method === "GET" && pathname === "/api/historical") {
    return historicalSummary(process.env.HISTORICAL_DATA_DIR || "./data/historical")
      .then(summary => json(res, 200, summary))
      .catch(error => json(res, 500, { error: error.message || "Historical data unavailable" }));
  }

  if (req.method === "POST" && pathname === "/api/walk-forward") {
    return readBody(req)
      .then(async body => {
        const directory = body.directory || process.env.HISTORICAL_DATA_DIR || "./data/historical";
        const rows = Array.isArray(body.rows)
          ? body.rows
          : await readHistoricalRows({
              directory,
              date: body.date,
              limit: Number(body.limit || 200000)
            });

        return json(res, 200, {
          source: Array.isArray(body.rows) ? "request" : "historical",
          rows: rows.length,
          date: body.date || null,
          result: runWalkForward(rows, body.options || {})
        });
      })
      .catch(error => json(res, 400, { error: error.message || "Invalid walk-forward request" }));
  }

  if (req.method === "POST" && pathname === "/api/backtest") {
    return readBody(req)
      .then(async body => {
        const directory = body.directory || process.env.HISTORICAL_DATA_DIR || "./data/historical";
        const rows = Array.isArray(body.rows)
          ? body.rows
          : await readHistoricalRows({
              directory,
              date: body.date,
              limit: Number(body.limit || 200000)
            });

        return json(res, 200, {
          source: Array.isArray(body.rows) ? "request" : "historical",
          rows: rows.length,
          date: body.date || null,
          result: runBacktest(rows, body.options || {})
        });
      })
      .catch(error => json(res, 400, { error: error.message || "Invalid backtest request" }));
  }

  return json(res, 404, { error: "Not found" });
}

const apiServer = http.createServer((req, res) => {
  Promise.resolve(handleRoute(req, res)).catch(error => {
    json(res, 500, { error: error.message || "Internal server error" });
  });
});

historical.start(markets);

async function boot() {
  try {
    await loadUniverse();
    universeTimer = setInterval(() => {
      loadUniverse().catch(error => console.error("Universe refresh failed:", error.message));
    }, REFRESH_UNIVERSE_MS);

    apiServer.listen(PORT, () => {
      console.log(`FK Signal Hunter API listening on :${PORT}`);
      console.log(`Tracking up to ${universe.length} assets across ${EXCHANGE_NAMES.length} exchanges`);
    });
  } catch (error) {
    console.error("FK Signal Hunter startup failed:", error);
    apiServer.listen(PORT, () => {
      console.log(`FK Signal Hunter API listening on :${PORT} (market discovery pending)`);
    });
    loadUniverse().catch(err => console.error("Initial universe retry failed:", err.message));
    universeTimer = setInterval(() => {
      loadUniverse().catch(err => console.error("Universe refresh failed:", err.message));
    }, REFRESH_UNIVERSE_MS);
  }
}

process.on("SIGINT", () => {
  if (universeTimer) clearInterval(universeTimer);
  historical.stop();
  hub?.stop();
  apiServer.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  if (universeTimer) clearInterval(universeTimer);
  historical.stop();
  hub?.stop();
  apiServer.close(() => process.exit(0));
});

boot();\n