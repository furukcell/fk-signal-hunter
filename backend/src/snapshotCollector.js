import ccxt from "ccxt";
import { FirebaseStore } from "./firebaseStore.js";
import { FEE_PROFILES } from "./paperEngine.js";
import { buildAnalytics } from "./signalAnalytics.js";

const MAX_COINS = Number(process.env.SNAPSHOT_MAX_COINS || 100);
const DEPTH_COINS = Number(process.env.SNAPSHOT_DEPTH_COINS || 20);
const ORDERBOOK_LIMIT = 20;
const QUOTE = "USDT";
const HISTORY_RETENTION_DAYS = 30;
const EXCHANGE_IDS = ["binance","coinbase","upbit","okx","bybit","bitget","gate","kucoin","mexc","htx"];
const BINANCE_PUBLIC_BASE = "https://data-api.binance.vision";
const BYBIT_PUBLIC_BASE = "https://api.bybit.com";
const BINANCE_TRADE_COINS = Number(process.env.SNAPSHOT_BINANCE_TRADE_COINS || 100);

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

async function fetchBinanceDirect(bases) {
  const [ticker24h, bookTicker] = await Promise.all([
    fetchJson(`${BINANCE_PUBLIC_BASE}/api/v3/ticker/24hr`),
    fetchJson(`${BINANCE_PUBLIC_BASE}/api/v3/ticker/bookTicker`)
  ]);
  const bySymbol = new Map((ticker24h || []).map(x => [x.symbol, x]));
  const books = new Map((bookTicker || []).map(x => [x.symbol, x]));
  const now = Date.now();

  return bases.map(base => {
    const symbol = `${base}USDT`;
    const t = bySymbol.get(symbol);
    const b = books.get(symbol);
    if (!t && !b) return null;
    const last = num(t?.lastPrice);
    const bid = num(b?.bidPrice);
    const ask = num(b?.askPrice);
    return {
      exchange: "binance",
      symbol,
      baseAsset: base,
      quoteAsset: "USDT",
      price: last ?? (bid != null && ask != null ? (bid + ask) / 2 : null),
      bid,
      ask,
      spreadPct: bid != null && ask != null && bid > 0 && ask >= bid ? ((ask - bid) / bid) * 100 : null,
      quoteVolume24h: num(t?.quoteVolume) ?? 0,
      volume24h: num(t?.volume) ?? 0,
      priceChangePct24h: num(t?.priceChangePercent),
      updatedAt: now,
      source: "binance-public-rest"
    };
  }).filter(Boolean);
}

async function fetchBybitDirect(bases) {
  const data = await fetchJson(`${BYBIT_PUBLIC_BASE}/v5/market/tickers?category=spot`);
  const bySymbol = new Map((data?.result?.list || []).map(x => [x.symbol, x]));
  const now = Date.now();
  return bases.map(base => {
    const symbol = `${base}USDT`;
    const t = bySymbol.get(symbol);
    if (!t) return null;
    const bid = num(t.bid1Price);
    const ask = num(t.ask1Price);
    return {
      exchange: "bybit",
      symbol,
      baseAsset: base,
      quoteAsset: "USDT",
      price: num(t.lastPrice) ?? (bid != null && ask != null ? (bid + ask) / 2 : null),
      bid,
      ask,
      spreadPct: bid != null && ask != null && bid > 0 && ask >= bid ? ((ask - bid) / bid) * 100 : null,
      quoteVolume24h: num(t.turnover24h) ?? 0,
      volume24h: num(t.volume24h) ?? 0,
      priceChangePct24h: num(t.price24hPcnt) != null ? num(t.price24hPcnt) * 100 : null,
      updatedAt: now,
      source: "bybit-public-rest"
    };
  }).filter(Boolean);
}

async function fetchBinanceFiveMinuteFlow(markets) {
  // Last completed 5-minute Binance spot candle for every tracked coin.
  // Kline data gives quote volume and taker-buy quote volume, so we can
  // estimate money entering via taker buys versus taker sells without keys.
  const targets = markets.filter(m => m.symbol);
  const results = await mapConcurrent(targets, 10, async m => {
    const rows = await fetchJson(
      `${BINANCE_PUBLIC_BASE}/api/v3/klines?symbol=${encodeURIComponent(m.symbol)}&interval=5m&limit=2`
    );
    const completed = Array.isArray(rows) && rows.length > 1 ? rows[rows.length - 2] : rows?.[0];
    if (!completed) return null;

    const openTime = Number(completed[0]) || null;
    const closeTime = Number(completed[6]) || null;
    const quoteVolume = num(completed[7]) ?? 0;
    const trades = Number(completed[8]) || 0;
    const buyQuote = num(completed[10]) ?? 0;
    const sellQuote = Math.max(0, quoteVolume - buyQuote);
    const total = buyQuote + sellQuote;

    return {
      symbol: m.symbol,
      flow5mAt: openTime,
      flow5mCloseAt: closeTime,
      buyVolume5m: buyQuote,
      sellVolume5m: sellQuote,
      flowVolume5m: total,
      netFlow5m: buyQuote - sellQuote,
      buyPressure5mPct: total > 0 ? (buyQuote / total) * 100 : null,
      sellPressure5mPct: total > 0 ? (sellQuote / total) * 100 : null,
      trades5m: trades,
      candle5mOpen: num(completed[1]),
      candle5mHigh: num(completed[2]),
      candle5mLow: num(completed[3]),
      candle5mClose: num(completed[4])
    };
  });
  return results.filter(Boolean);
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

  if (m.buyPressurePct != null) {
    if (m.buyPressurePct >= 60) { score += 10; reasons.push("Binance buy pressure"); }
    else if (m.buyPressurePct >= 55) score += 5;
    else if (m.buyPressurePct <= 40) { score -= 10; reasons.push("Binance sell pressure"); }
    else if (m.buyPressurePct <= 45) score -= 5;
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
    const binanceFlow = m.binanceFlow;
    if (binanceFlow) {
      m.buyPressurePct = binanceFlow.buyPressure5mPct;
      m.flowVolume = binanceFlow.flowVolume5m;
      m.trades = binanceFlow.trades5m;
      m.lastTradeAt = binanceFlow.flow5mCloseAt;
      m.buyVolume5m = binanceFlow.buyVolume5m;
      m.sellVolume5m = binanceFlow.sellVolume5m;
      m.flowVolume5m = binanceFlow.flowVolume5m;
      m.netFlow5m = binanceFlow.netFlow5m;
      m.buyPressure5mPct = binanceFlow.buyPressure5mPct;
      m.sellPressure5mPct = binanceFlow.sellPressure5mPct;
      m.trades5m = binanceFlow.trades5m;
      m.candle5mOpen = binanceFlow.candle5mOpen;
      m.candle5mHigh = binanceFlow.candle5mHigh;
      m.candle5mLow = binanceFlow.candle5mLow;
      m.candle5mClose = binanceFlow.candle5mClose;
      m.flow5mAt = binanceFlow.flow5mAt;
      m.flow5mCloseAt = binanceFlow.flow5mCloseAt;
    }
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
  const state = previous || {
    initialBalance: 1000,
    balance: 1000,
    positions: [],
    trades: [],
    totalTrades: 0,
    wins: 0,
    losses: 0,
    realizedPnl: 0,
    peakEquity: 1000,
    maxDrawdownPct: 0,
    equityHistory: [],
    lastRunAt: null
  };

  state.initialBalance = num(state.initialBalance) ?? 1000;
  state.balance = num(state.balance) ?? state.initialBalance;
  state.positions = Array.isArray(state.positions) ? state.positions : [];
  state.trades = Array.isArray(state.trades) ? state.trades : [];
  state.equityHistory = Array.isArray(state.equityHistory) ? state.equityHistory : [];
  state.marketPrices = state.marketPrices && typeof state.marketPrices === "object" ? state.marketPrices : {};

  // Compare this scan with the previous 5-minute scan. This is deliberately
  // separate from the 24h momentum so the UI can show the short-term move.
  for (const m of markets) {
    const previousPrice = num(state.marketPrices[m.symbol]);
    m.priceChangePct5m = previousPrice != null && previousPrice > 0 && m.last != null
      ? ((m.last - previousPrice) / previousPrice) * 100
      : null;
  }
  state.marketPrices = Object.fromEntries(
    markets.map(m => [m.symbol, m.last]).filter(([, price]) => price != null)
  );

  const map = new Map(markets.map(m => [m.symbol, m]));
  const closedTrades = [];
  const remaining = [];

  for (const p of state.positions) {
    const m = map.get(p.symbol);
    const venue = m?.exchangeData?.[p.exchange];
    const exit = num(venue?.bid) ?? num(m?.bid) ?? num(m?.last);

    if (!Number.isFinite(exit)) {
      remaining.push(p);
      continue;
    }

    const changePct = ((exit - p.entryPrice) / p.entryPrice) * 100;
    const hitTp = changePct >= 1;
    const hitSl = changePct <= -0.8;

    if (!hitTp && !hitSl) {
      remaining.push(p);
      continue;
    }

    const gross = (exit - p.entryPrice) * p.quantity;
    const entryFee = p.entryPrice * p.quantity * p.feeRate;
    const exitFee = exit * p.quantity * p.feeRate;
    const fees = entryFee + exitFee;
    const netPnl = gross - fees;

    // Entry fee was already reserved from cash at entry. At exit, return the position principal plus gross P&L minus only the exit fee.
    state.balance += p.quoteCost + gross - exitFee;
    state.realizedPnl += netPnl;
    state.totalTrades += 1;
    if (netPnl > 0) state.wins += 1;
    else state.losses += 1;

    const trade = {
      ...p,
      exitPrice: exit,
      grossPnl: gross,
      fees,
      netPnl,
      returnPct: p.quoteCost > 0 ? (netPnl / p.quoteCost) * 100 : 0,
      closedAt: now,
      holdingMinutes: Math.max(0, (now - p.openedAt) / 60000),
      reason: hitTp ? "TP_1PCT" : "SL_0_8PCT"
    };

    closedTrades.push(trade);
    state.trades.unshift(trade);
  }

  state.positions = remaining;
  state.trades = state.trades.slice(0, 200);

  const candidates = markets
    .filter(m =>
      m.score >= 82 &&
      m.activeExchangeCount >= 3 &&
      Number(m.quoteVolume24h || 0) >= 10_000_000 &&
      Number(m.spreadPct ?? 999) <= 0.30
    )
    .sort((a, b) => b.score - a.score);

  // Sequential paper trading: one open position at a time, 10% of current cash per trade.
  // There is no daily trade-count limit. Once a position closes, the next eligible opportunity can use the newly available cash.
  if (state.positions.length === 0) {
    for (const m of candidates) {
      if (state.positions.some(p => p.symbol === m.symbol)) continue;
      if (m.buyPressurePct != null && m.buyPressurePct < 50) continue;
      if (m.weightedImbalancePct != null && m.weightedImbalancePct < -10) continue;

    const venues = Object.entries(m.exchangeData || {})
      .map(([exchange, data]) => ({ exchange, ...data }))
      .filter(v => Number.isFinite(v.ask) && v.ask > 0 && Number.isFinite(v.bid) && v.bid > 0);

    if (!venues.length) continue;

    const entryVenue = venues.reduce((a, b) =>
      (b.quoteVolume24h || 0) > (a.quoteVolume24h || 0) ? b : a
    );
    const entry = entryVenue.ask;
    const availableCash = state.balance;
    const quoteCost = availableCash * 0.10;

    if (!Number.isFinite(entry) || entry <= 0 || quoteCost < 1) continue;

    const feeRate = 0.001;
    const quantity = quoteCost / (entry * (1 + feeRate));
    const actualCost = quantity * entry;
    const entryFee = actualCost * feeRate;
    const totalReserved = actualCost + entryFee;

    if (totalReserved > state.balance) continue;

    state.balance -= totalReserved;
      state.positions.push({
        id: `paper-${m.symbol}-${now}`,
        symbol: m.symbol,
        exchange: entryVenue.exchange,
        entryPrice: entry,
        quantity,
        quoteCost: actualCost,
        feeRate,
        entryFee,
        score: m.score,
        signal: m.signal,
        reasons: m.reasons,
        openedAt: now
      });
      break;
    }
  }

  const openValue = state.positions.reduce((sum, p) => {
    const m = map.get(p.symbol);
    const venue = m?.exchangeData?.[p.exchange];
    const mark = num(venue?.bid) ?? num(m?.bid) ?? p.entryPrice;
    return sum + p.quantity * mark;
  }, 0);

  state.equity = state.balance + openValue;
  state.returnPct = ((state.equity - state.initialBalance) / state.initialBalance) * 100;
  state.peakEquity = Math.max(num(state.peakEquity) ?? state.initialBalance, state.equity);
  const drawdownPct = state.peakEquity > 0
    ? ((state.peakEquity - state.equity) / state.peakEquity) * 100
    : 0;
  state.maxDrawdownPct = Math.max(num(state.maxDrawdownPct) ?? 0, drawdownPct);
  state.winRate = state.totalTrades > 0 ? (state.wins / state.totalTrades) * 100 : null;
  state.averageTradePnl = state.totalTrades > 0 ? state.realizedPnl / state.totalTrades : null;
  state.availableCash = state.balance;
  state.openPositionValue = openValue;
  state.unrealizedPnl = openValue - state.positions.reduce((sum, p) => sum + (p.quoteCost || 0), 0);
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayTrades = state.trades.filter(t => Number(t.closedAt) >= todayStart.getTime());
  state.todayTrades = todayTrades.length;
  state.todayPnl = todayTrades.reduce((sum, t) => sum + (Number(t.netPnl) || 0), 0);
  state.positionSizePct = 10;
  state.takeProfitPct = 1;
  state.stopLossPct = -0.8;
  state.feeRate = 0.001;
  state.strategy = "SKOR_82_PLUS_SEQUENTIAL";
  state.maxConcurrentPositions = 1;
  state.mode = "PAPER_ONLY";
  state.lastRunAt = now;

  state.equityHistory.push({
    ts: now,
    equity: state.equity,
    cash: state.balance,
    openValue,
    realizedPnl: state.realizedPnl,
    openPositions: state.positions.length
  });
  state.equityHistory = state.equityHistory.slice(-2000);

  return { state, closedTrades };
}

function compact(m) {
  return {
    symbol: m.symbol, baseAsset: m.baseAsset, last: m.last, bid: m.bid, ask: m.ask,
    spreadPct: m.spreadPct, quoteVolume24h: m.quoteVolume24h, volume24h: m.volume24h,
    priceChangePct24h: m.priceChangePct24h, priceChangePct5m: m.priceChangePct5m, exchangeCount: m.exchangeCount,
    activeExchangeCount: m.activeExchangeCount, staleExchangeCount: m.staleExchangeCount,
    priceDispersionPct: m.priceDispersionPct, buyConsensus: m.buyConsensus,
    buyPressurePct: m.buyPressurePct, buyVolume5m: m.buyVolume5m, sellVolume5m: m.sellVolume5m,
    flowVolume5m: m.flowVolume5m, netFlow5m: m.netFlow5m, buyPressure5mPct: m.buyPressure5mPct,
    sellPressure5mPct: m.sellPressure5mPct, trades5m: m.trades5m, flow5mAt: m.flow5mAt,
    flow5mCloseAt: m.flow5mCloseAt, candle5mOpen: m.candle5mOpen, candle5mHigh: m.candle5mHigh,
    candle5mLow: m.candle5mLow, candle5mClose: m.candle5mClose, imbalancePct: m.imbalancePct,
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

  // Binance and Bybit are our primary public market-data sources.
  // They require no API key and are used before CCXT so a CCXT outage
  // does not silently remove these two important venues.
  try {
    const direct = await fetchBinanceDirect(bases);
    rows.push(...direct);
    console.log(`binance direct: ${direct.length} tickers`);
  } catch (error) {
    console.error(`binance direct failed: ${error.message}`);
  }

  try {
    const direct = await fetchBybitDirect(bases);
    rows.push(...direct);
    console.log(`bybit direct: ${direct.length} tickers`);
  } catch (error) {
    console.error(`bybit direct failed: ${error.message}`);
  }

  for (const id of EXCHANGE_IDS) {
    try {
      const exchange = makeExchange(id);
      await exchange.loadMarkets();
      const symbols = bases.map(base => pickMarket(exchange.markets, base)).filter(Boolean).map(m => m.symbol);
      const tickers = id === "binance" || id === "bybit" ? [] : await fetchTickers(exchange, symbols);
      if (id !== "binance" && id !== "bybit") {
        for (const ticker of tickers) {
          const market = exchange.markets[ticker.symbol];
          if (market?.quote === "USDT") rows.push(normalizeTicker(id, ticker, market, Date.now()));
        }
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

  try {
    const flow = await fetchBinanceFiveMinuteFlow(markets);
    const bySymbol = new Map(flow.map(x => [x.symbol, x]));
    for (const m of markets) {
      m.binanceFlow = bySymbol.get(m.symbol) || null;
      if (m.binanceFlow) {
        m.buyPressurePct = m.binanceFlow.buyPressurePct;
        m.flowVolume = m.binanceFlow.flowVolume;
        m.trades = m.binanceFlow.trades;
        m.lastTradeAt = m.binanceFlow.lastTradeAt;
      }
      scoreMarket(m);
    }
    console.log(`binance 5m money flow: ${flow.length} markets`);
  } catch (error) {
    console.error(`binance trade flow failed: ${error.message}`);
  }

  await enrichDepth(markets, exchanges);

  for (const m of markets) m.opportunity = buildOpportunity(m);
  const now = Date.now();
  const previous = await firebase.read("public", "paperState");
  const paperResult = await runPaper(previous?.payload ? JSON.parse(previous.payload) : null, markets, now);
  const paper = paperResult.state;
  for (const trade of paperResult.closedTrades) {
    await firebase.recordPaperTrade(trade);
  }
  const previousAnalytics = await firebase.read("public", "analyticsState");
  const analytics = buildAnalytics(previousAnalytics?.payload || null, markets, now);

  const rankedMarkets = markets.slice().sort((a, b) => b.score - a.score);
  const payload = {
    generatedAt: new Date(now).toISOString(), intervalMinutes: 5, universeSize: markets.length,
    exchanges: EXCHANGE_IDS, markets: markets.map(compact),
    signals: rankedMarkets.filter(m => m.signal !== "WAIT").slice(0, 50),
    paper,
    health: {
      collector: "github-actions", durationMs: Date.now() - startedAt,
      exchangeRows: rows.length, exchangesWithData: new Set(rows.map(x => x.exchange)).size,
      binanceDirect: rows.some(x => x.exchange === "binance" && x.source === "binance-public-rest"),
      bybitDirect: rows.some(x => x.exchange === "bybit" && x.source === "bybit-public-rest"),
      binanceTradeFlowMarkets: markets.filter(m => m.binanceFlow).length,
      depthMarkets: markets.filter(m => m.bids.length || m.asks.length).length,
      freeMode: true
    }
  };

  await firebase.write("public", "paperState", {
    schemaVersion: 1, generatedAt: new Date(now).toISOString(), payload: JSON.stringify(paper)
  }, true);
  await firebase.write("public", "analyticsState", {
    schemaVersion: 1, generatedAt: new Date(now).toISOString(), payload: JSON.stringify(analytics.state)
  }, true);
  await firebase.writePublicSnapshot(payload);
  await firebase.writeHistoricalSnapshot(now, payload);

  const cutoff = now - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const deletedHistoricalSnapshots = await firebase.deleteHistoricalSnapshotsOlderThan(cutoff);

  console.log(JSON.stringify({
    generatedAt: payload.generatedAt, markets: markets.length,
    exchangesWithData: payload.health.exchangesWithData,
    depthMarkets: payload.health.depthMarkets,
    deletedHistoricalSnapshots,
    historyRetentionDays: HISTORY_RETENTION_DAYS,
    topSignals: payload.signals.slice(0, 5).map(x => [x.symbol, x.score, x.signal]),
    durationMs: payload.health.durationMs
  }, null, 2));
}

main().catch(error => {
  console.error("Snapshot collector failed:", error);
  process.exitCode = 1;
});
