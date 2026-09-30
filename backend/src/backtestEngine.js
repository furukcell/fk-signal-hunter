import { FEE_PROFILES } from "./paperEngine.js";

const DEFAULTS = {
  initialBalance: 1000,
  positionPct: 0.15,
  tpPct: 0.02,
  slPct: 0.008,
  maxOpenPositions: 2
};

function fee(exchange) {
  return (FEE_PROFILES[exchange]?.taker ?? 0.001) * 100;
}

function runBacktest(rows = [], options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const sorted = [...rows].sort((a, b) => Number(a.ts) - Number(b.ts));
  let balance = Number(cfg.initialBalance);
  const positions = new Map();
  const trades = [];
  let peak = balance;
  let maxDrawdownPct = 0;

  for (const row of sorted) {
    const price = Number(row.price);
    if (!Number.isFinite(price) || price <= 0) continue;

    const symbol = row.symbol;
    const score = Number(row.score || 0);

    const open = positions.get(symbol);
    if (open) {
      open.lastPrice = price;
      if (price >= open.takeProfit || price <= open.stopLoss) {
        const exitFee = price * open.quantity * open.feeRate;
        const entryFee = open.entryPrice * open.quantity * open.feeRate;
        const gross = (price - open.entryPrice) * open.quantity;
        const net = gross - entryFee - exitFee - open.slippage;
        balance += open.allocation + net;
        trades.push({
          symbol, exchange: open.exchange, entryPrice: open.entryPrice,
          exitPrice: price, netPnl: net, fees: entryFee + exitFee,
          slippage: open.slippage, reason: price >= open.takeProfit ? "TP" : "SL",
          score: open.score, openedAt: open.openedAt, closedAt: row.ts
        });
        positions.delete(symbol);
      }
    }

    if (
      score >= Number(cfg.entryScore || 82) &&
      !positions.has(symbol) &&
      positions.size < Number(cfg.maxOpenPositions) &&
      Number(row.buyConsensus || 0) >= 0.7 &&
      Number(row.exchangeCount || 0) >= 3
    ) {
      const allocation = balance * Number(cfg.positionPct);
      const exchange = row.exchange || "binance";
      const feeRate = fee(exchange) / 100;
      const spreadPct = Number(row.spreadPct || 0);
      const slippagePct = Math.max(0.005, spreadPct / 2);
      const slippage = allocation * (slippagePct / 100);
      balance -= allocation;
      const effectiveEntry = price * (1 + feeRate + slippagePct / 100);
      positions.set(symbol, {
        symbol, exchange, allocation,
        quantity: allocation / effectiveEntry,
        entryPrice: price,
        takeProfit: price * (1 + Number(cfg.tpPct)),
        stopLoss: price * (1 - Number(cfg.slPct)),
        feeRate, slippage, score, openedAt: row.ts
      });
    }

    let equity = balance;
    for (const p of positions.values()) equity += p.quantity * p.lastPrice;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - equity) / peak) * 100);
  }

  const wins = trades.filter(t => t.netPnl > 0);
  const losses = trades.filter(t => t.netPnl < 0);
  const grossProfit = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  const netPnl = trades.reduce((s, t) => s + t.netPnl, 0);

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
    closedTrades: trades
  };
}

export { runBacktest };
