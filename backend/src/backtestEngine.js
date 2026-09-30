import { FEE_PROFILES } from "./paperEngine.js";

const DEFAULTS = {
  initialBalance: 1000,
  positionPct: 0.15,
  tpPct: 0.02,
  slPct: 0.008,
  maxOpenPositions: 2,
  entryScore: 82,
  minBuyConsensus: 0.7,
  minExchangeCount: 3,
  entryDelayMs: 0,
  maxHoldMs: 15 * 60 * 1000,
  cooldownMs: 60 * 1000,
  slippageBps: 5,
  conservativeAmbiguous: true
};

function fee(exchange) {
  return (FEE_PROFILES[exchange]?.taker ?? 0.001);
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function closePosition(open, exitPrice, closedAt, reason) {
  const slippageRate = open.slippageBps / 10_000;
  const exitFillPrice = exitPrice * (1 - slippageRate);
  const exitNotional = exitFillPrice * open.quantity;
  const exitFee = exitNotional * open.feeRate;
  const gross = (exitFillPrice - open.entryFillPrice) * open.quantity;
  const net = gross - open.entryFee - exitFee;

  return {
    symbol: open.symbol,
    exchange: open.exchange,
    entryPrice: open.entryPrice,
    entryFillPrice: open.entryFillPrice,
    exitPrice,
    exitFillPrice,
    netPnl: net,
    fees: open.entryFee + exitFee,
    slippage: open.allocation * (open.slippageBps / 10_000)
      + Math.max(0, open.entryFillPrice - open.entryPrice) * open.quantity,
    reason,
    score: open.score,
    openedAt: open.openedAt,
    closedAt
  };
}

function runBacktest(rows = [], options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const sorted = [...rows]
    .filter(row => Number.isFinite(Number(row.ts)))
    .sort((a, b) => Number(a.ts) - Number(b.ts));

  let balance = finite(cfg.initialBalance, 1000);
  const positions = new Map();
  const cooldowns = new Map();
  const trades = [];
  let peak = balance;
  let maxDrawdownPct = 0;
  let previousPriceBySymbol = new Map();

  const closeAndRecord = (symbol, open, price, ts, reason) => {
    const trade = closePosition(open, price, ts, reason);
    balance += open.allocation + trade.netPnl;
    trades.push(trade);
    positions.delete(symbol);
    cooldowns.set(symbol, ts + Number(cfg.cooldownMs));
  };

  for (const row of sorted) {
    const price = finite(row.price, NaN);
    if (!Number.isFinite(price) || price <= 0) continue;

    const symbol = row.symbol;
    if (!symbol) continue;

    const previousPrice = previousPriceBySymbol.get(symbol);
    const open = positions.get(symbol);

    if (open) {
      open.lastPrice = price;

      const hitTp = previousPrice == null
        ? price >= open.takeProfit
        : previousPrice < open.takeProfit && price >= open.takeProfit;
      const hitSl = previousPrice == null
        ? price <= open.stopLoss
        : previousPrice > open.stopLoss && price <= open.stopLoss;

      let reason = null;
      if (hitTp && hitSl) {
        reason = cfg.conservativeAmbiguous ? "AMBIGUOUS_SL" : "AMBIGUOUS_TP_SL";
      } else if (hitSl) {
        reason = "SL";
      } else if (hitTp) {
        reason = "TP";
      } else if (
        Number(cfg.maxHoldMs) > 0 &&
        Number(row.ts) - Number(open.openedAt) >= Number(cfg.maxHoldMs)
      ) {
        reason = "TIMEOUT";
      }

      if (reason) closeAndRecord(symbol, open, price, row.ts, reason);
    }

    const cooldownUntil = cooldowns.get(symbol) || 0;
    const canEnter =
      !positions.has(symbol) &&
      Number(row.ts) >= cooldownUntil &&
      Number(row.score || 0) >= Number(cfg.entryScore) &&
      Number(row.buyConsensus || 0) >= Number(cfg.minBuyConsensus) &&
      Number(row.exchangeCount || 0) >= Number(cfg.minExchangeCount) &&
      positions.size < Number(cfg.maxOpenPositions);

    if (canEnter) {
      const allocation = balance * Number(cfg.positionPct);
      if (allocation > 0) {
        const exchange = row.exchange || row.opportunity?.bestBuyExchange || "binance";
        const feeRate = fee(exchange);
        const spreadPct = Math.max(0, finite(row.spreadPct));
        const slippagePct = Math.max(
          finite(cfg.slippageBps) / 100,
          spreadPct / 2
        );
        const entryFillPrice = price * (1 + slippagePct / 100);
        const entryFee = allocation * feeRate;

        balance -= allocation;
        positions.set(symbol, {
          symbol,
          exchange,
          allocation,
          quantity: allocation / entryFillPrice,
          entryPrice: price,
          entryFillPrice,
          takeProfit: price * (1 + Number(cfg.tpPct)),
          stopLoss: price * (1 - Number(cfg.slPct)),
          feeRate,
          entryFee,
          slippageBps: slippagePct * 100,
          score: Number(row.score || 0),
          openedAt: row.ts,
          lastPrice: price
        });
      }
    }

    let equity = balance;
    for (const p of positions.values()) {
      equity += p.quantity * p.lastPrice;
    }
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(
      maxDrawdownPct,
      peak > 0 ? ((peak - equity) / peak) * 100 : 0
    );

    previousPriceBySymbol.set(symbol, price);
  }

  const finalTs = sorted.length ? sorted[sorted.length - 1].ts : Date.now();
  for (const open of positions.values()) {
    const finalPrice = finite(open.lastPrice, NaN);
    if (!Number.isFinite(finalPrice) || finalPrice <= 0) continue;
    const trade = closePosition(open, finalPrice, finalTs, "END_OF_DATA");
    balance += open.allocation + trade.netPnl;
    trades.push(trade);
  }
  positions.clear();

  const wins = trades.filter(t => t.netPnl > 0);
  const losses = trades.filter(t => t.netPnl < 0);
  const grossProfit = wins.reduce((sum, t) => sum + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.netPnl, 0));
  const netPnl = trades.reduce((sum, t) => sum + t.netPnl, 0);

  return {
    initialBalance: cfg.initialBalance,
    finalBalance: balance,
    netPnl,
    returnPct: ((balance - cfg.initialBalance) / cfg.initialBalance) * 100,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    profitFactor: grossLoss ? grossProfit / grossLoss : null,
    maxDrawdownPct,
    expectancy: trades.length ? netPnl / trades.length : 0,
    config: {
      entryScore: cfg.entryScore,
      minBuyConsensus: cfg.minBuyConsensus,
      minExchangeCount: cfg.minExchangeCount,
      tpPct: cfg.tpPct,
      slPct: cfg.slPct,
      positionPct: cfg.positionPct,
      maxOpenPositions: cfg.maxOpenPositions,
      entryDelayMs: cfg.entryDelayMs,
      maxHoldMs: cfg.maxHoldMs,
      cooldownMs: cfg.cooldownMs,
      slippageBps: cfg.slippageBps,
      conservativeAmbiguous: cfg.conservativeAmbiguous
    },
    closedTrades: trades
  };
}

export { runBacktest };
