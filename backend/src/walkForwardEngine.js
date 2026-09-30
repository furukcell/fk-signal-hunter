import { runBacktest } from "./backtestEngine.js";

const DEFAULT_GRID = {
  entryScore: [80, 82, 85],
  tpPct: [0.015, 0.02, 0.025],
  slPct: [0.006, 0.008, 0.01]
};

function asArray(value, fallback) {
  if (Array.isArray(value) && value.length) return value;
  return fallback;
}

function lowerBound(rows, target) {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (Number(rows[mid].ts) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(rows, target) {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (Number(rows[mid].ts) <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function candidateScore(result, minTrades) {
  if (result.trades < minTrades) return Number.NEGATIVE_INFINITY;
  const pf = result.profitFactor == null ? 0 : Math.min(result.profitFactor, 3);
  return result.returnPct - result.maxDrawdownPct * 0.5 + pf * 0.25;
}

function makeCandidates(grid) {
  const entries = asArray(grid.entryScore, DEFAULT_GRID.entryScore);
  const tps = asArray(grid.tpPct, DEFAULT_GRID.tpPct);
  const sls = asArray(grid.slPct, DEFAULT_GRID.slPct);
  const candidates = [];

  for (const entryScore of entries) {
    for (const tpPct of tps) {
      for (const slPct of sls) {
        candidates.push({ entryScore, tpPct, slPct });
      }
    }
  }
  return candidates;
}

function runWalkForward(rows = [], options = {}) {
  const sorted = [...rows]
    .filter(row => Number.isFinite(Number(row.ts)) && row.symbol)
    .sort((a, b) => Number(a.ts) - Number(b.ts));

  if (sorted.length < 2) {
    return { windows: [], aggregate: null, candidates: 0 };
  }

  const trainMs = Number(options.trainMs || 7 * 24 * 60 * 60 * 1000);
  const testMs = Number(options.testMs || 24 * 60 * 60 * 1000);
  const stepMs = Number(options.stepMs || testMs);
  const maxRowsPerWindow = Number(options.maxRowsPerWindow || 100000);
  const minTrainingTrades = Number(options.minTrainingTrades || 10);
  const baseOptions = { ...(options.baseOptions || {}) };
  const candidates = makeCandidates(options.grid || DEFAULT_GRID);
  const windows = [];

  const firstTs = Number(sorted[0].ts);
  const lastTs = Number(sorted[sorted.length - 1].ts);
  let cursor = firstTs + trainMs;

  while (cursor + testMs <= lastTs) {
    const trainStart = cursor - trainMs;
    const testEnd = cursor + testMs;

    const trainStartIndex = lowerBound(sorted, trainStart);
    const trainEndIndex = lowerBound(sorted, cursor);
    const testStartIndex = trainEndIndex;
    const testEndIndex = lowerBound(sorted, testEnd);

    let train = sorted.slice(trainStartIndex, trainEndIndex);
    let test = sorted.slice(testStartIndex, testEndIndex);

    if (train.length > maxRowsPerWindow) train = train.slice(-maxRowsPerWindow);
    if (test.length > maxRowsPerWindow) test = test.slice(0, maxRowsPerWindow);

    if (!train.length || !test.length) {
      cursor += stepMs;
      continue;
    }

    let best = null;
    for (const candidate of candidates) {
      const result = runBacktest(train, { ...baseOptions, ...candidate });
      const score = candidateScore(result, minTrainingTrades);
      if (!best || score > best.score) {
        best = { candidate, score, result };
      }
    }

    if (!best || !Number.isFinite(best.score)) {
      windows.push({
        trainStart,
        trainEnd: cursor,
        testStart: cursor,
        testEnd,
        trainRows: train.length,
        testRows: test.length,
        selected: null,
        inSample: null,
        outOfSample: null,
        skipped: true,
        reason: "INSUFFICIENT_TRAINING_TRADES"
      });
      cursor += stepMs;
      continue;
    }

    const outOfSample = runBacktest(test, {
      ...baseOptions,
      ...best.candidate
    });

    windows.push({
      trainStart,
      trainEnd: cursor,
      testStart: cursor,
      testEnd,
      trainRows: train.length,
      testRows: test.length,
      selected: best.candidate,
      inSample: {
        returnPct: best.result.returnPct,
        netPnl: best.result.netPnl,
        trades: best.result.trades,
        profitFactor: best.result.profitFactor,
        maxDrawdownPct: best.result.maxDrawdownPct
      },
      outOfSample: {
        returnPct: outOfSample.returnPct,
        netPnl: outOfSample.netPnl,
        trades: outOfSample.trades,
        winRate: outOfSample.winRate,
        profitFactor: outOfSample.profitFactor,
        maxDrawdownPct: outOfSample.maxDrawdownPct
      }
    });

    cursor += stepMs;
  }

  const evaluated = windows.filter(w => w.outOfSample);
  const testReturns = evaluated.map(w => Number(w.outOfSample.returnPct || 0));
  const testPnl = evaluated.reduce((sum, w) => sum + Number(w.outOfSample.netPnl || 0), 0);
  const positiveWindows = evaluated.filter(w => Number(w.outOfSample.netPnl || 0) > 0).length;
  const averageReturnPct = testReturns.length
    ? testReturns.reduce((sum, value) => sum + value, 0) / testReturns.length
    : 0;

  return {
    windows,
    candidates: candidates.length,
    aggregate: {
      windows: evaluated.length,
      skippedWindows: windows.length - evaluated.length,
      positiveWindows,
      positiveWindowRate: evaluated.length ? positiveWindows / evaluated.length : 0,
      averageOutOfSampleReturnPct: averageReturnPct,
      totalOutOfSamplePnl: testPnl
    }
  };
}

export { runWalkForward };
