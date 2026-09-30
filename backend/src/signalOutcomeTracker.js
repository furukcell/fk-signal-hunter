function utcDate(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

class SignalOutcomeTracker {
  constructor({ store, getMarket, horizonMs = 30 * 60_000 }) {
    this.store = store;
    this.getMarket = getMarket;
    this.horizonMs = horizonMs;
    this.pending = new Map();
    this.lastSignalAt = new Map();
    this.daily = new Map();
    this.currentDate = utcDate();
    this.lastDailyFlushAt = 0;
  }

  observe(market, opportunity, timestamp = Date.now()) {
    if (!this.store?.enabled || !opportunity?.actionable) return;
    const symbol = market.symbol;
    const last = Number(this.lastSignalAt.get(symbol) || 0);
    if (timestamp - last < 5 * 60_000) return;

    const price = Number(market.last);
    if (!Number.isFinite(price) || price <= 0) return;

    this.lastSignalAt.set(symbol, timestamp);
    const id = symbol + "-" + timestamp;
    const signal = {
      id,
      symbol,
      baseAsset: market.baseAsset,
      quoteAsset: market.quoteAsset,
      timestamp,
      priceAtSignal: price,
      score: Number(market.score),
      signal: market.signal,
      buyPressurePct: market.buyPressurePct,
      volumeAnomaly: market.volumeAnomaly,
      momentumPct1m: market.momentumPct1m,
      weightedImbalancePct: market.weightedImbalancePct,
      persistencePct: market.persistencePct,
      sellAbsorption: market.sellAbsorption,
      activeExchangeCount: market.activeExchangeCount,
      buyConsensus: market.buyConsensus,
      spreadPct: market.spreadPct,
      opportunity: {
        bestBuyExchange: opportunity.bestBuy?.exchange || null,
        bestSellExchange: opportunity.bestSell?.exchange || null,
        estimatedNetCrossExchangeEdgePct: opportunity.estimatedNetCrossExchangeEdgePct ?? null
      }
    };

    this.pending.set(id, {
      ...signal,
      samples: [{ offsetMs: 0, price }],
      maxFavorablePct: 0,
      maxAdversePct: 0
    });

    if (this.pending.size > 500) {
      const oldest = this.pending.keys().next().value;
      if (oldest) this.pending.delete(oldest);
    }

    void this.store.recordSignal(signal);
  }

  observePrice(market, timestamp = Date.now()) {
    const symbol = market.symbol;
    const price = Number(market.last);
    if (!Number.isFinite(price) || price <= 0) return;

    for (const [id, item] of this.pending) {
      if (item.symbol !== symbol) continue;
      const age = timestamp - item.timestamp;
      if (age < 0) continue;

      const movePct = ((price - item.priceAtSignal) / item.priceAtSignal) * 100;
      item.maxFavorablePct = Math.max(item.maxFavorablePct, movePct);
      item.maxAdversePct = Math.min(item.maxAdversePct, movePct);

      for (const horizon of [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000]) {
        if (age >= horizon && !item.samples.some(x => x.offsetMs === horizon)) {
          item.samples.push({ offsetMs: horizon, price, movePct });
        }
      }

      if (age >= this.horizonMs) {
        void this.finalize(id, item, timestamp);
      }
    }
  }

  async finalize(id, item, timestamp) {
    if (!this.pending.has(id)) return;
    this.pending.delete(id);

    const at15 = item.samples.find(x => x.offsetMs === 15 * 60_000);
    const at30 = item.samples.find(x => x.offsetMs === 30 * 60_000);
    const finalMovePct = at30?.movePct ?? at15?.movePct ?? null;
    const result = item.maxFavorablePct >= 2
      ? "TP_REACHED"
      : item.maxAdversePct <= -0.8
        ? "SL_REACHED"
        : "NO_THRESHOLD";

    const outcome = {
      samples: item.samples,
      maxFavorablePct: item.maxFavorablePct,
      maxAdversePct: item.maxAdversePct,
      movePct15m: at15?.movePct ?? null,
      movePct30m: at30?.movePct ?? finalMovePct,
      result,
      completedAt: timestamp
    };

    await this.store.recordSignalOutcome(id, outcome);

    const date = utcDate(item.timestamp);
    const stats = this.daily.get(date) || {
      signals: 0,
      tpReached: 0,
      slReached: 0,
      noThreshold: 0,
      sumMove15m: 0,
      move15mSamples: 0,
      paperTrades: 0,
      paperWins: 0,
      paperLosses: 0,
      paperNetPnl: 0
    };
    stats.signals += 1;
    if (result === "TP_REACHED") stats.tpReached += 1;
    else if (result === "SL_REACHED") stats.slReached += 1;
    else stats.noThreshold += 1;
    if (Number.isFinite(at15?.movePct)) {
      stats.sumMove15m += at15.movePct;
      stats.move15mSamples += 1;
    }
    this.daily.set(date, stats);
  }

  recordPaperTrade(trade, timestamp = Date.now()) {
    const date = utcDate(timestamp);
    const stats = this.daily.get(date) || {
      signals: 0,
      tpReached: 0,
      slReached: 0,
      noThreshold: 0,
      sumMove15m: 0,
      move15mSamples: 0,
      paperTrades: 0,
      paperWins: 0,
      paperLosses: 0,
      paperNetPnl: 0
    };
    stats.paperTrades += 1;
    const pnl = Number(trade.netPnl ?? trade.pnl ?? 0);
    stats.paperNetPnl += Number.isFinite(pnl) ? pnl : 0;
    if (pnl > 0) stats.paperWins += 1;
    else if (pnl < 0) stats.paperLosses += 1;
    this.daily.set(date, stats);
  }

  async flushDaily(date = this.currentDate) {
    const stats = this.daily.get(date);
    if (!stats) return;
    await this.store.writeDailySummary(date, {
      date,
      signalOutcomes: stats.signals,
      tpReached: stats.tpReached,
      slReached: stats.slReached,
      noThreshold: stats.noThreshold,
      paperTrades: stats.paperTrades || 0,
      paperWins: stats.paperWins || 0,
      paperLosses: stats.paperLosses || 0,
      paperNetPnl: stats.paperNetPnl || 0,
      outcomeWinRatePct: stats.signals
        ? (stats.tpReached / stats.signals) * 100
        : 0,
      averageMove15mPct: stats.move15mSamples
        ? stats.sumMove15m / stats.move15mSamples
        : null
    });
  }

  async tick(timestamp = Date.now()) {
    this.currentDate = utcDate(timestamp);
    for (const market of this.getMarket()) {
      this.observePrice(market, timestamp);
    }
    for (const date of this.daily.keys()) {
      if (date < this.currentDate) await this.flushDaily(date);
    }
    if (timestamp - this.lastDailyFlushAt >= 60 * 60_000) {
      await this.flushDaily(this.currentDate);
      this.lastDailyFlushAt = timestamp;
    }
  }
}

export { SignalOutcomeTracker };