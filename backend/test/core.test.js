import test from "node:test";
import assert from "node:assert/strict";
import { PaperEngine } from "../src/paperEngine.js";
import { buildOpportunity } from "../src/signalEngine.js";
import { SignalOutcomeTracker } from "../src/signalOutcomeTracker.js";

test("PaperEngine opens and closes a position with fees", () => {
  const paper = new PaperEngine({
    initialBalance: 1000,
    positionPct: 0.15,
    tpPct: 0.02,
    slPct: 0.008,
    maxOpenPositions: 2,
    dailyLossPct: 0.015,
    cooldownMs: 60_000
  });

  const opened = paper.open({
    symbol: "BTC",
    exchange: "binance",
    price: 100,
    spreadPct: 0.01,
    score: 90,
    asks: [{ price: 100, qty: 2 }],
    timestamp: 1_000
  });

  assert.equal(opened.opened, true);
  assert.equal(paper.positions.size, 1);

  const closed = paper.update("BTC", 102.5, 2_000, {
    bids: [{ price: 102.5, qty: 2 }]
  });

  assert.equal(closed.reason, "TP");
  assert.equal(paper.positions.size, 0);
  assert.equal(paper.trades.length, 1);
  assert.ok(Number.isFinite(closed.netPnl));
  assert.ok(closed.netPnl < 4);
});

test("PaperEngine enforces duplicate position and cooldown", () => {
  const paper = new PaperEngine({ initialBalance: 1000, cooldownMs: 60_000 });

  const first = paper.open({
    symbol: "ETH",
    exchange: "binance",
    price: 100,
    asks: [{ price: 100, qty: 2 }],
    timestamp: 1_000
  });
  assert.equal(first.opened, true);

  const duplicate = paper.open({
    symbol: "ETH",
    exchange: "binance",
    price: 100,
    asks: [{ price: 100, qty: 2 }],
    timestamp: 2_000
  });
  assert.equal(duplicate.reason, "already_open");

  const closed = paper.close("ETH", 100, "TEST", 3_000, {
    bids: [{ price: 100, qty: 2 }]
  });
  assert.ok(closed);

  const cooldown = paper.open({
    symbol: "ETH",
    exchange: "binance",
    price: 100,
    asks: [{ price: 100, qty: 2 }],
    timestamp: 30_000
  });
  assert.equal(cooldown.reason, "cooldown");
});

test("signal engine requires a real cross-exchange edge after fees", () => {
  const market = {
    symbol: "BTCUSDT",
    score: 90,
    buyConsensus: 0.8,
    quoteVolume24h: 1_000_000,
    exchangeData: {
      binance: {
        quoteAsset: "USDT",
        ask: 100,
        bid: 99.9,
        updatedAt: Date.now()
      },
      okx: {
        quoteAsset: "USDT",
        ask: 100.1,
        bid: 101,
        updatedAt: Date.now()
      },
      bybit: {
        quoteAsset: "USDT",
        ask: 100.2,
        bid: 100.8,
        updatedAt: Date.now()
      }
    }
  };

  const opportunity = buildOpportunity(market);

  assert.equal(opportunity.exchangeCount, 3);
  assert.equal(opportunity.bestBuy.exchange, "binance");
  assert.equal(opportunity.bestSell.exchange, "okx");
  assert.ok(opportunity.grossCrossExchangeSpreadPct > 0);
  assert.ok(opportunity.estimatedNetCrossExchangeEdgePct > 0);
  assert.equal(opportunity.actionable, true);
});

test("signal engine rejects stale exchange quotes", () => {
  const market = {
    symbol: "BTCUSDT",
    score: 95,
    buyConsensus: 0.9,
    exchangeData: {
      binance: {
        quoteAsset: "USDT",
        ask: 100,
        bid: 99,
        updatedAt: Date.now() - 31_000
      },
      okx: {
        quoteAsset: "USDT",
        ask: 100,
        bid: 99,
        updatedAt: Date.now()
      }
    }
  };

  const opportunity = buildOpportunity(market);

  assert.equal(opportunity.exchangeCount, 1);
  assert.equal(opportunity.actionable, false);
});


test("SignalOutcomeTracker records important signals and evaluates the 15m/30m outcome", async () => {
  const writes = [];
  const store = {
    enabled: true,
    async recordSignal(signal) { writes.push({ type: "signal", signal }); },
    async recordSignalOutcome(id, outcome) { writes.push({ type: "outcome", id, outcome }); },
    async writeDailySummary(date, summary) { writes.push({ type: "daily", date, summary }); }
  };
  let market = {
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    last: 100,
    score: 88,
    signal: "WATCH",
    buyPressurePct: 72,
    volumeAnomaly: 2.7,
    momentumPct1m: 0.4,
    weightedImbalancePct: 15,
    persistencePct: 70,
    sellAbsorption: 0.8,
    activeExchangeCount: 8,
    buyConsensus: 0.78,
    spreadPct: 0.01
  };
  const tracker = new SignalOutcomeTracker({
    store,
    getMarket: () => [market]
  });
  const t0 = Date.parse("2026-09-30T10:00:00.000Z");

  tracker.observe(market, { actionable: true }, t0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].type, "signal");

  market = { ...market, last: 102.5 };
  await tracker.tick(t0 + 30 * 60_000);

  const outcomeWrite = writes.find(x => x.type === "outcome");
  assert.ok(outcomeWrite);
  assert.equal(outcomeWrite.outcome.result, "TP_REACHED");
  assert.equal(outcomeWrite.outcome.movePct15m, 2.5);
  assert.equal(outcomeWrite.outcome.movePct30m, 2.5);
});
