import ccxt from "ccxt";
import { FirebaseStore } from "./firebaseStore.js";
import { FEE_PROFILES } from "./paperEngine.js";

const MAX_COINS = Number(process.env.SNAPSHOT_MAX_COINS || 100);
const DEPTH_COINS = Number(process.env.SNAPSHOT_DEPTH_COINS || 20);
const ORDERBOOK_LIMIT = 20;
const QUOTE = "USDT";
const EXCHANGE_IDS = ["binance","coinbase","upbit","okx","bybit","bitget","gate","kucoin","mexc","htx"];

const num = value => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "FK-Signal-Hunter/0.1" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadUniverse() {
  try {
    const key = process.env.COINGECKO_API_KEY || "";
    const url = key
      ? `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${MAX_COINS}&page=1&sparkline=false&x_cg_demo_api_key=${encodeURIComponent(key)}`
      : `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${MAX_COINS}&page=1&sparkline=false`;
    const rows = await fetchJson(url);
    return rows.map(x => String(x.symbol || "").toUpperCase())
      .filter(Boolean)
      .filter(x => !/^(USDT|USDC|BUSD|DAI|FDUSD|TUSD|USDE|USDD|PYUSD)$/.test(x));
  } catch (error) {
    console.warn("CoinGecko unavailable; using exchange volume fallback:", error.message);
    return [];
  }
}

function makeExchange(id) {
  const Exchange = ccxt[id];
  if (!Exchange) throw new Error(`CCXT exchange not found: ${id}`);
  return new Exchange({ enableRateLimit: true, timeout: 15000, options: { defaultType: "spot" } });
}

function pickMarket(markets, base) {
  const m = markets[`${base}/USDT`];
  return m && m.spot && m.active !== false ? m : null;
}

function normalizeTicker(exchange, ticker, market, now) {
  const last = num(ticker.last);
  const bid = num(ticker.bid);
  const ask = num(ticker.ask);
  const price = last ?? (bid != null && ask != null ? (bid + ask) / 2 : null);
  return {
    exchange, symbol: market.symbol, baseAsset: market.base, quoteAsset: market.quote,
    price, bid, ask,
    spreadPct: bid != null && ask != null && bid > 0 && ask > 0 && ask >= bid
      ? ((ask - bid) / bid) * 100
      : null,
    quoteVolume24h: num(ticker.quoteVolume) ?? 0,
    volume24h: num(ticker.baseVolume) ?? 0,
    priceChangePct24h: num(ticker.percentage),
    updatedAt: now
  };
}

async function fetchTickers(exchange, symbols) {
  if (exchange.has.fetchTickers) {
    try {
      const all = await exchange.fetchTickers();
      return symbols.map(s => all[s]).filter(Boolean);
    } catch (error) {
      console.warn(`${exchange.id} bulk ticker failed: ${error.message}`);
    }
  }
  const result = [];
  for (const symbol of symbols) {
    try { result.push(await exchange.fetchTicker(symbol)); } catch {}
  }
  return result;
}

async function mapConcurrent(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try { output[i] = await worker(items[i], i); } catch { output[i] = null; }
    }
  }));
  return output;
}

function bookFeatures(book) {
  const bids = (book?.bids || []).map(x => [num(x[0]), num(x[1])]).filter(x => x[0] > 0 && x[1] > 0);
  const asks = (book?.asks || []).map(x => [num(x[0]), num(x[1])]).filter(x => x[0] > 0 && x[1] > 0);
  const bidNotional = bids.reduce((s, x) => s + x[0] * x[1], 0);
  const askNotional = asks.reduce((s, x) => s + x[0] * x[1], 0);
  const total = bidNotional + askNotional;
  return {
    bids: bids.slice(0, ORDERBOOK_LIMIT).map(x => ({ price: x[0], qty: x[1] })),
    asks: asks.slice(0, ORDERBOOK_LIMIT).map(x => ({ price: x[0], qty: x[1] })),
    imbalancePct: total > 0 ? ((bidNotional - askNotional) / total) * 100 : null
  };
}

function scoreMarket(m) {
  let score = 50;
  const reasons = [];
  const momentum = num(m.priceChangePct24h) ?? 0;
  if (momentum >= 1) { score += 10; reasons.push("Positive 24h momentum"); }
  else if (momentum >= 0.25) score += 5;
  else if (momentum <= -1) { score -= 10; reasons.push("Negative 24h momentum"); }
  else if (momentum <= -0.25) score -= 5;

  if (m.quoteVolume24h >= 100_000_000) { score += 8; reasons.push("High 24h liquidity"); }
  else if (m.quoteVolume24h >= 25_000_000) score += 4;

  if (m.activeExchangeCount >= 7) { score += 7; reasons.push("Strong exchange coverage"); }
  else if (m.activeExchangeCount >= 4) score += 4;
  else if (m.activeExchangeCount < 2) { score -= 8; reasons.push("Low exchange coverage"); }

  if (m.priceDispersionPct != null) {
    if (m.priceDispersionPct <= 0.20) score += 4;
    else if (m.priceDispersionPct >= 1) score -= 4;
  }

  if (m.weightedImbalancePct != null) {
    if (m.weightedImbalancePct >= 20) { score += 12; reasons.push("Strong bid-side depth"); }
    else if (m.weightedImbalancePct >= 8) score += 6;
    else if (m.weightedImbalancePct <= -20) { score -= 12; reasons.push("Strong ask-side depth"); }
    else if (m.weightedImbalancePct <= -8) score -= 6;
  }

  if (m.spreadPct != null) {
    if (m.spreadPct <= 0.05) score += 4;
    else if (m.spreadPct >= 0.20) score -= 5;
  }

  m.score = clamp(Math.round(score), 0, 100);
  m.signal = m.score >= 82 ? "WATCH" : m.score >= 70 ? "MONITOR" : "WAIT";
  m.reasons = reasons.slice(0, 5);
}

function aggregateUniverse(bases, rows) {
  const map = new Map();
  for (const base of bases) {
    map.set(`${base}USDT`, {
      symbol: `${base}USDT`, baseAsset: base, quoteAsset: QUOTE,
      bid: null, ask: null, last: null, spreadPct: null,
      quoteVolume24h: 0, volume24h: 0, priceChangePct24h: null,
      exchangeCount: 0, activeExchangeCount: 0, staleExchangeCount: 0,
      priceDispersionPct: null, buyConsensus: 0, buyPressurePct: null,
      imbalancePct: null, weightedImbalancePct: null, bids: [], asks: [],
      exchangeData: {}, score: 50, signal: "WAIT", reasons: [], updatedAt: Date.now()
    });
  }

  for (const row of rows) {
    const m = map.get(`${row.baseAsset}USDT`);
    if (!m) continue;
    m.exchangeData[row.exchange] = row;
    m.exchangeCount++;
    if (row.price != null || (row.bid != null && row.ask != null)) m.activeExchangeCount++;
    m.quoteVolume24h = Math.max(m.quoteVolume24h, row.quoteVolume24h || 0);
    m.volume24h = Math.max(m.volume24h, row.volume24h || 0);
    if (m.priceChangePct24h == null || Math.abs(row.priceChangePct24h || 0) > Math.abs(m.priceChangePct24h)) {
      m.priceChangePct24h = row.priceChangePct24h;
    }
  }

  for (const m of map.values()) {
    const venues = Object.values(m.exchangeData);
    const pricedVenues = venues.filter(x => Number.isFinite(x.price) && x.price > 0);
    const quoteVenues = venues.filter(x => Number.isFinite(x.bid) && x.bid > 0 && Number.isFinite(x.ask) && x.ask > 0);

    if (pricedVenues.length) {
      const sortedPrices = pricedVenues.map(x => x.price).sort((a, b) => a - b);
      const middle = Math.floor(sortedPrices.length / 2);
      m.last = sortedPrices.length % 2
        ? sortedPrices[middle]
        : (sortedPrices[middle - 1] + sortedPrices[middle]) / 2;
    }

    // Display a real executable bid/ask pair from one venue, rather than
    // combining the highest bid with the lowest ask across different venues.
    // Cross-exchange differences are handled separately by buildOpportunity().
    const reference = quoteVenues
      .slice()
      .sort((a, b) => (b.quoteVolume24h || 0) - (a.quoteVolume24h || 0))[0];

    if (reference) {
      m.bid = reference.bid;
      m.ask = reference.ask;
    }

    const localSpreads = quoteVenues
      .map(x => x.spreadPct)
      .filter(Number.isFinite);

    if (localSpreads.length) {
      m.spreadPct = Math.min(...localSpreads);
    }

    if (pricedVenues.length >= 2 && m.last > 0) {
      m.priceDispersionPct = ((Math.max(...pricedVenues.map(x => x.price)) - Math.min(...pricedVenues.map(x => x.price))) / m.last) * 100;
    }

    m.staleExchangeCount = Math.max(0, m.exchangeCount - m.activeExchangeCount);
    scoreMarket(m);
  }
  return [...map.values()];
}

async function enrichDepth(markets, exchanges) {
  const targets = markets.slice().sort((a, b) => (b.quoteVolume24h || 0) - (a.quoteVolume24h || 0)).slice(0, DEPTH_COINS);
  for (const exchange of exchanges) {
    const targetsForExchange = targets.filter(m => exchange.markets[`${m.baseAsset}/USDT`]);
    await mapConcurrent(targetsForExchange, 4, async m => {
      try {
        const book = await exchange.fetchOrderBook(`${m.baseAsset}/USDT`, ORDERBOOK_LIMIT);
        const f = bookFeatures(book);
        const row = m.exchangeData[exchange.id];
        if (row) Object.assign(row, { bids: f.bids, asks: f.asks, imbalancePct: f.imbalancePct });
      } catch {}
    });
  }

  for (const m of markets) {
    const rows = Object.values(m.exchangeData).filter(x => x.bids?.length && x.asks?.length);
    if (!rows.length) continue;
    const values = rows.map(x => Number(x.imbalancePct)).filter(Number.isFinite);
    m.weightedImbalancePct = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const preferred = rows.find(x => x.exchange === "binance") || rows[0];
    m.bids = preferred.bids;
    m.asks = preferred.asks;
    m.imbalancePct = preferred.imbalancePct;
    scoreMarket(m);
  }
}

function buildOpportunity(m) {
  const venues = Object.entries(m.exchangeData).map(([exchange, data]) => ({ exchange, ...data }))
    .filter(x => Number.isFinite(x.bid) && Number.isFinite(x.ask) && x.bid > 0 && x.ask > 0);
  if (!venues.length) return null;
  const bestBuy = venues.reduce((a, b) => b.ask < a.ask ? b : a);
  const bestSell = venues.reduce((a, b) => b.bid > a.bid ? b : a);
  const gross = bestBuy.exchange !== bestSell.exchange ? ((bestSell.bid - bestBuy.ask) / bestBuy.ask) * 100 : 0;
  const buyFee = (FEE_PROFILES[bestBuy.exchange]?.taker ?? 0.001) * 100;
  const sellFee = (FEE_PROFILES[bestSell.exchange]?.taker ?? 0.001) * 100;
  const net = gross - buyFee - sellFee;
  return {
    symbol: m.symbol, score: m.score, exchangeCount: venues.length,
    bestBuy: { exchange: bestBuy.exchange, ask: bestBuy.ask },
    bestSell: { exchange: bestSell.exchange, bid: bestSell.bid },
    grossCrossExchangeSpreadPct: gross,
    estimatedRoundTripFeesPct: buyFee + sellFee,
    estimatedNetCrossExchangeEdgePct: net,
    buyConsensus: m.buyConsensus,
    actionable: m.score >= 82 && venues.length >= 3 && net >= 0.15
  };
}

async function runPaper(previous, markets, now) {
  const state = previous || { initialBalance: 1000, balance: 1000, positions: [], trades: [], lastRunAt: null };
  const map = new Map(markets.map(m => [m.symbol, m]));
  const remaining = [];
  const closed = [];

  for (const p of state.positions || []) {
    const m = map.get(p.symbol);
    const exit = m?.bid ?? m?.last;
    if (!Number.isFinite(exit)) { remaining.push(p); continue; }
    const changePct = ((exit - p.entryPrice) / p.entryPrice) * 100;
    if (changePct >= 2 || changePct <= -0.8) {
      const gross = (exit - p.entryPrice) * p.quantity;
      const fees = p.entryPrice * p.quantity * p.feeRate + exit * p.quantity * p.feeRate;
      const netPnl = gross - fees;
      state.balance += p.quoteCost + netPnl;
      closed.push({ ...p, exitPrice: exit, netPnl, closedAt: now, reason: changePct >= 2 ? "TP_2PCT" : "SL_0_8PCT" });
    } else remaining.push(p);
  }
  state.positions = remaining;
  state.trades = [...closed, ...(state.trades || [])].slice(0, 200);

  const candidates = markets.filter(m => m.opportunity?.actionable && m.activeExchangeCount >= 3)
    .sort((a, b) => b.score - a.score);
  for (const m of candidates) {
    if (state.positions.length >= 2) break;
    if (state.positions.some(p => p.symbol === m.symbol)) continue;
    const entry = m.ask ?? m.last;
    if (!Number.isFinite(entry) || entry <= 0) continue;
    const quoteCost = state.balance * 0.15;
    if (quoteCost < 1) continue;
    const feeRate = 0.001;
    const quantity = quoteCost / (entry * (1 + feeRate));
    state.balance -= quoteCost;
    state.positions.push({
      id: `paper-${m.symbol}-${now}`, symbol: m.symbol, exchange: m.opportunity.bestBuy.exchange,
      entryPrice: entry, quantity, quoteCost, feeRate, score: m.score, openedAt: now
    });
  }

  state.lastRunAt = now;
  const openValue = state.positions.reduce((sum, p) => sum + p.quantity * (map.get(p.symbol)?.last ?? p.entryPrice), 0);
  state.equity = state.balance + openValue;
  state.returnPct = ((state.equity - state.initialBalance) / state.initialBalance) * 100;
  return state;
}

function compact(m) {
  return {
    symbol: m.symbol, baseAsset: m.baseAsset, last: m.last, bid: m.bid, ask: m.ask,
    spreadPct: m.spreadPct, quoteVolume24h: m.quoteVolume24h, volume24h: m.volume24h,
    priceChangePct24h: m.priceChangePct24h, exchangeCount: m.exchangeCount,
    activeExchangeCount: m.activeExchangeCount, staleExchangeCount: m.staleExchangeCount,
    priceDispersionPct: m.priceDispersionPct, buyConsensus: m.buyConsensus,
    buyPressurePct: m.buyPressurePct, imbalancePct: m.imbalancePct,
    weightedImbalancePct: m.weightedImbalancePct, bids: m.bids, asks: m.asks,
    score: m.score, signal: m.signal, reasons: m.reasons, opportunity: m.opportunity,
    exchangeData: m.exchangeData, updatedAt: m.updatedAt
  };
}

async function main() {
  const startedAt = Date.now();
  const firebase = new FirebaseStore();
  if (!firebase.enabled) throw new Error("Firebase credentials are required");

  let bases = await loadUniverse();
  const exchanges = [];
  const rows = [];

  for (const id of EXCHANGE_IDS) {
    try {
      const exchange = makeExchange(id);
      await exchange.loadMarkets();
      const symbols = bases.map(base => pickMarket(exchange.markets, base)).filter(Boolean).map(m => m.symbol);
      const tickers = await fetchTickers(exchange, symbols);
      for (const ticker of tickers) {
        const market = exchange.markets[ticker.symbol];
        if (market?.quote === "USDT") rows.push(normalizeTicker(id, ticker, market, Date.now()));
      }
      exchanges.push(exchange);
      console.log(`${id}: ${tickers.length} tickers`);
    } catch (error) {
      console.error(`${id} failed: ${error.message}`);
    }
  }

  if (!bases.length) {
    bases = [...new Set(rows.map(x => x.baseAsset))].slice(0, MAX_COINS);
  }
  let markets = aggregateUniverse(bases.slice(0, MAX_COINS), rows);
  await enrichDepth(markets, exchanges);

  for (const m of markets) m.opportunity = buildOpportunity(m);
  const now = Date.now();
  const previous = await firebase.read("public", "paperState");
  const paper = await runPaper(previous?.payload ? JSON.parse(previous.payload) : null, markets, now);

  markets = markets.sort((a, b) => b.score - a.score).slice(0, MAX_COINS);
  const payload = {
    generatedAt: new Date(now).toISOString(), intervalMinutes: 5, universeSize: markets.length,
    exchanges: EXCHANGE_IDS, markets: markets.map(compact),
    signals: markets.filter(m => m.signal !== "WAIT").slice(0, 50),
    paper,
    health: {
      collector: "github-actions", durationMs: Date.now() - startedAt,
      exchangeRows: rows.length, exchangesWithData: new Set(rows.map(x => x.exchange)).size,
      depthMarkets: markets.filter(m => m.bids.length || m.asks.length).length,
      freeMode: true
    }
  };

  await firebase.write("public", "paperState", {
    schemaVersion: 1, generatedAt: new Date(now).toISOString(), payload: JSON.stringify(paper)
  }, true);
  await firebase.writePublicSnapshot(payload);
  await firebase.writeHistoricalSnapshot(now, payload);

  console.log(JSON.stringify({
    generatedAt: payload.generatedAt, markets: markets.length,
    exchangesWithData: payload.health.exchangesWithData,
    depthMarkets: payload.health.depthMarkets,
    topSignals: payload.signals.slice(0, 5).map(x => [x.symbol, x.score, x.signal]),
    durationMs: payload.health.durationMs
  }, null, 2));
}

main().catch(error => {
  console.error("Snapshot collector failed:", error);
  process.exitCode = 1;
});
