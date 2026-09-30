import fs from "node:fs";
import path from "node:path";

class HistoricalCollector {
  constructor(options = {}) {
    this.directory = options.directory || process.env.HISTORICAL_DATA_DIR || "./data/historical";
    this.intervalMs = Number(options.intervalMs || 10000);
    this.timer = null;
    this.running = false;
    this.writeErrors = 0;
    this.samplesWritten = 0;
    fs.mkdirSync(this.directory, { recursive: true });
  }

  filePath(timestamp = Date.now()) {
    const date = new Date(timestamp).toISOString().slice(0, 10);
    return path.join(this.directory, `${date}.jsonl`);
  }

  serializeMarket(m) {
    return {
      ts: Date.now(),
      symbol: m.symbol,
      exchange: m.opportunity?.bestBuy?.exchange || "binance",
      baseAsset: m.baseAsset,
      quoteAsset: m.quoteAsset,
      price: m.last,
      bid: m.bid,
      ask: m.ask,
      spreadPct: m.spreadPct,
      score: m.score,
      signal: m.signal,
      buyPressurePct: m.buyPressurePct,
      flowVolume1m: m.flowVolume,
      volumeRateBaseline: m.volumeRateBaseline,
      volumeAnomaly: m.volumeAnomaly,
      momentumPct1m: m.momentumPct1m,
      imbalancePct: m.imbalancePct,
      weightedImbalancePct: m.weightedImbalancePct,
      largeBidRatio: m.largeBidRatio,
      largeAskRatio: m.largeAskRatio,
      persistencePct: m.persistencePct,
      bidPersistencePct: m.bidPersistencePct,
      askPersistencePct: m.askPersistencePct,
      bookPullRatio: m.bookPullRatio,
      bookReplenishmentRatio: m.bookReplenishmentRatio,
      sellAbsorption: m.sellAbsorption,
      buyAbsorption: m.buyAbsorption,
      absorptionSignal: m.absorptionSignal,
      exchangeCount: m.exchangeCount,
      activeExchangeCount: m.activeExchangeCount,
      staleExchangeCount: m.staleExchangeCount,
      buyConsensus: m.buyConsensus,
      priceDispersionPct: m.priceDispersionPct,
      quoteVolume24h: m.quoteVolume24h,
      priceChangePct24h: m.priceChangePct24h,
      opportunity: m.opportunity
        ? {
            bestBuyExchange: m.opportunity.bestBuy?.exchange || null,
            bestSellExchange: m.opportunity.bestSell?.exchange || null,
            grossCrossExchangeSpreadPct: m.opportunity.grossCrossExchangeSpreadPct,
            estimatedRoundTripFeesPct: m.opportunity.estimatedRoundTripFeesPct,
            estimatedNetCrossExchangeEdgePct: m.opportunity.estimatedNetCrossExchangeEdgePct,
            actionable: m.opportunity.actionable
          }
        : null
    };
  }

  write(markets) {
    const rows = [];
    for (const m of markets.values()) {
      if (!m.last && !m.bid && !m.ask) continue;
      rows.push(JSON.stringify(this.serializeMarket(m)));
    }
    if (!rows.length) return;

    try {
      fs.appendFileSync(this.filePath(), rows.join("\n") + "\n", "utf8");
      this.samplesWritten += rows.length;
    } catch {
      this.writeErrors += 1;
    }
  }

  start(markets) {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.write(markets), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }

  snapshot() {
    return {
      running: this.running,
      intervalMs: this.intervalMs,
      directory: this.directory,
      samplesWritten: this.samplesWritten,
      writeErrors: this.writeErrors
    };
  }
}

export { HistoricalCollector };
