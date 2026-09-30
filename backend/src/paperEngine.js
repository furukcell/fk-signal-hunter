const DEFAULT_BALANCE = 1000;
const DEFAULT_POSITION_PCT = 0.15;
const DEFAULT_TP_PCT = 0.02;
const DEFAULT_SL_PCT = 0.008;

const FEE_PROFILES = {
  binance: { maker: 0.001, taker: 0.001 },
  coinbase: { maker: 0.006, taker: 0.012 },
  upbit: { maker: 0.0005, taker: 0.0005 },
  okx: { maker: 0.001, taker: 0.001 },
  bybit: { maker: 0.001, taker: 0.001 },
  bitget: { maker: 0.001, taker: 0.001 },
  gate: { maker: 0.001, taker: 0.001 },
  kucoin: { maker: 0.001, taker: 0.001 },
  mexc: { maker: 0.001, taker: 0.001 },
  htx: { maker: 0.002, taker: 0.002 }
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function effectiveCostPct({ spreadPct = 0, slippagePct = 0, feePct = 0 }) {
  return Number(spreadPct) + Number(slippagePct) + Number(feePct);
}

function estimateMarketFill(levels = [], quoteAmount, fallbackPrice) {
  const target = Number(quoteAmount);
  const fallback = Number(fallbackPrice);
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(fallback) || fallback <= 0) {
    return { averagePrice: fallback, quantity: target > 0 && fallback > 0 ? target / fallback : 0, slippagePct: 0, filledQuote: 0 };
  }

  let remainingQuote = target;
  let filledQuote = 0;
  let filledQty = 0;

  for (const level of levels || []) {
    const price = Number(level.price);
    const qty = Number(level.qty);
    if (price <= 0 || qty <= 0) continue;

    const levelQuote = price * qty;
    const takeQuote = Math.min(remainingQuote, levelQuote);
    filledQuote += takeQuote;
    filledQty += takeQuote / price;
    remainingQuote -= takeQuote;

    if (remainingQuote <= 1e-9) break;
  }

  if (filledQuote <= 0) {
    return { averagePrice: fallback, quantity: target / fallback, slippagePct: 0, filledQuote: target };
  }

  // If visible depth is insufficient, model the unfilled remainder at a 0.20% penalty.
  if (remainingQuote > 0) {
    const penaltyPrice = fallback * 1.002;
    filledQuote += remainingQuote;
    filledQty += remainingQuote / penaltyPrice;
  }

  const averagePrice = filledQuote / filledQty;
  const slippagePct = Math.max(0, ((averagePrice - fallback) / fallback) * 100);
  return { averagePrice, quantity: filledQty, slippagePct, filledQuote: target };
}

class PaperEngine {
  constructor(options = {}) {
    this.initialBalance = Number(options.initialBalance || DEFAULT_BALANCE);
    this.balance = this.initialBalance;
    this.positionPct = Number(options.positionPct || DEFAULT_POSITION_PCT);
    this.tpPct = Number(options.tpPct || DEFAULT_TP_PCT);
    this.slPct = Number(options.slPct || DEFAULT_SL_PCT);
    this.maxOpenPositions = Number(options.maxOpenPositions || 2);
    this.dailyLossPct = Number(options.dailyLossPct || 0.015);
    this.positions = new Map();
    this.trades = [];
    this.dayStartBalance = this.balance;
  }

  fee(exchange, side = "taker") {
    const p = FEE_PROFILES[exchange] || FEE_PROFILES.binance;
    return side === "maker" ? p.maker : p.taker;
  }

  resetDay() {
    this.dayStartBalance = this.equity();
  }

  equity(prices = {}) {
    let value = this.balance;
    for (const p of this.positions.values()) {
      const price = Number(prices[p.symbol] || p.lastPrice || p.entryPrice);
      value += p.quantity * price;
    }
    return value;
  }

  canOpen() {
    const equity = this.equity();
    const dailyLoss = Math.max(0, (this.dayStartBalance - equity) / this.dayStartBalance);
    return this.positions.size < this.maxOpenPositions && dailyLoss < this.dailyLossPct;
  }

  open({ symbol, exchange = "binance", price, spreadPct = 0, score = 0, bids = [], asks = [], timestamp = Date.now() }) {
    if (!this.canOpen()) return { opened: false, reason: "risk_limit" };
    if (this.positions.has(symbol)) return { opened: false, reason: "already_open" };

    const entryPrice = Number(price);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) return { opened: false, reason: "invalid_price" };

    const allocation = this.balance * clamp(this.positionPct, 0.01, 0.25);
    const feeRate = this.fee(exchange, "taker");
    const fill = estimateMarketFill(asks, allocation, entryPrice);
    const spreadCostPct = Number(spreadPct || 0) / 2;
    const entryCostPct = effectiveCostPct({
      spreadPct: spreadCostPct,
      slippagePct: fill.slippagePct,
      feePct: feeRate * 100
    });
    const effectiveEntry = fill.averagePrice * (1 + feeRate);
    const quantity = fill.quantity;

    const position = {
      symbol, exchange, quantity, allocation,
      entryPrice, effectiveEntry, lastPrice: entryPrice,
      entrySlippagePct: fill.slippagePct,
      entryCostPct, feeRate, score, openedAt: timestamp,
      takeProfit: entryPrice * (1 + this.tpPct),
      stopLoss: entryPrice * (1 - this.slPct)
    };

    this.balance -= allocation;
    this.positions.set(symbol, position);
    return { opened: true, position };
  }

  update(symbol, price, timestamp = Date.now(), book = {}) {
    const p = this.positions.get(symbol);
    if (!p) return null;
    const current = Number(price);
    p.lastPrice = current;

    if (current >= p.takeProfit) return this.close(symbol, current, "TP", timestamp, book);
    if (current <= p.stopLoss) return this.close(symbol, current, "SL", timestamp, book);
    return null;
  }

  close(symbol, price, reason = "SIGNAL", timestamp = Date.now(), book = {}) {
    const p = this.positions.get(symbol);
    if (!p) return null;

    const exitPrice = Number(price);
    const exitNotionalTarget = p.quantity * exitPrice;
    const exitFill = estimateMarketFill(book.bids, exitNotionalTarget, exitPrice);
    const effectiveExit = exitFill.averagePrice;
    const grossPnl = (effectiveExit - p.entryPrice) * p.quantity;
    const exitFee = effectiveExit * p.quantity * p.feeRate;
    const entryFee = p.entryPrice * p.quantity * p.feeRate;
    const slippage = Math.max(0, (exitPrice - effectiveExit) * p.quantity);
    const netPnl = grossPnl - entryFee - exitFee;

    this.balance += p.allocation + netPnl;
    this.positions.delete(symbol);

    const trade = {
      id: String(timestamp) + "-" + symbol,
      symbol,
      exchange: p.exchange,
      side: "LONG",
      entryPrice: p.entryPrice,
      exitPrice: effectiveExit,
      requestedExitPrice: exitPrice,
      quantity: p.quantity,
      grossPnl,
      netPnl,
      fees: entryFee + exitFee,
      slippage,
      reason,
      score: p.score,
      openedAt: p.openedAt,
      closedAt: timestamp
    };
    this.trades.unshift(trade);
    this.trades = this.trades.slice(0, 5000);
    return trade;
  }

  snapshot(prices = {}) {
    const equity = this.equity(prices);
    const realized = this.trades.reduce((sum, t) => sum + t.netPnl, 0);
    const wins = this.trades.filter(t => t.netPnl > 0);
    const losses = this.trades.filter(t => t.netPnl < 0);
    const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
    return {
      balance: this.balance,
      equity,
      initialBalance: this.initialBalance,
      realizedPnl: realized,
      openPositions: [...this.positions.values()],
      trades: this.trades,
      winRate: this.trades.length ? wins.length / this.trades.length : 0,
      profitFactor: grossLoss ? grossProfit / grossLoss : null,
      returnPct: ((equity - this.initialBalance) / this.initialBalance) * 100
    };
  }
}

export { PaperEngine, FEE_PROFILES };
