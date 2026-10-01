const WINDOW_MS = 24 * 60 * 60 * 1000;
const SCORE_INTERVAL_MS = 15 * 60 * 1000;
const OPPORTUNITY_SCORE = 82;
const SIGNAL_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const HORIZONS = [
  { key: "r30m", ms: 30 * 60 * 1000 },
  { key: "r1h", ms: 60 * 60 * 1000 },
  { key: "r2h", ms: 2 * 60 * 60 * 1000 }
];

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

function readState(raw) {
  if (!raw) return { version: 1, scorePoints: [], events: [] };
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      version: 1,
      scorePoints: Array.isArray(parsed.scorePoints) ? parsed.scorePoints : [],
      events: Array.isArray(parsed.events) ? parsed.events : []
    };
  } catch {
    return { version: 1, scorePoints: [], events: [] };
  }
}

function compactMarket(m) {
  return { s: m.symbol, score: finite(m.score) ?? 0, p: finite(m.last) };
}

function addScorePoint(state, markets, now) {
  const last = state.scorePoints[state.scorePoints.length - 1];
  if (last && now - Number(last.ts) < SCORE_INTERVAL_MS) return;
  state.scorePoints.push({ ts: now, markets: markets.map(compactMarket) });
  const cutoff = now - WINDOW_MS;
  state.scorePoints = state.scorePoints.filter(point => Number(point.ts) >= cutoff);
}

function createEvent(m, now) {
  return {
    id: "sig-" + m.symbol + "-" + now,
    symbol: m.symbol,
    signalAt: now,
    score: finite(m.score) ?? 0,
    entryPrice: finite(m.ask) ?? finite(m.last),
    currentPrice: finite(m.last),
    signal: "WATCH",
    source: "score-threshold",
    r30m: null,
    r1h: null,
    r2h: null,
    maxReturn30m: null,
    maxReturn1h: null,
    maxReturn2h: null,
    resolvedAt: null
  };
}

function updateEvent(event, market, now) {
  const current = finite(market?.last);
  const entry = finite(event.entryPrice);
  if (!current || !entry || entry <= 0) return;

  event.currentPrice = current;
  const age = now - Number(event.signalAt);
  const changePct = ((current - entry) / entry) * 100;

  if (age >= 0) event.maxReturn30m = Math.max(finite(event.maxReturn30m) ?? -Infinity, changePct);
  if (age >= HORIZONS[0].ms) event.r30m ??= changePct;
  if (age >= HORIZONS[1].ms) {
    event.r1h ??= changePct;
    event.maxReturn1h = Math.max(finite(event.maxReturn1h) ?? -Infinity, changePct);
  }
  if (age >= HORIZONS[2].ms) {
    event.r2h ??= changePct;
    event.maxReturn2h = Math.max(finite(event.maxReturn2h) ?? -Infinity, changePct);
    event.resolvedAt ??= now;
  }
}

function summarize(events, markets, now) {
  const cutoff = now - WINDOW_MS;
  const recent = events.filter(e => Number(e.signalAt) >= cutoff);

  const summaries = markets.map(m => {
    const rows = recent.filter(e => e.symbol === m.symbol);
    const avg = key => {
      const values = rows.map(e => finite(e[key])).filter(v => v != null);
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    };
    const hit = key => {
      const values = rows.map(e => finite(e[key])).filter(v => v != null);
      return values.length ? (values.filter(v => v > 0).length / values.length) * 100 : null;
    };
    const maxReturn2h = rows.map(e => finite(e.maxReturn2h)).filter(v => v != null);
    const worstReturn2h = rows.map(e => finite(e.r2h)).filter(v => v != null);

    return {
      symbol: m.symbol,
      score: finite(m.score) ?? 0,
      currentPrice: finite(m.last),
      opportunities24h: rows.length,
      resolved30m: rows.filter(e => e.r30m != null).length,
      resolved1h: rows.filter(e => e.r1h != null).length,
      resolved2h: rows.filter(e => e.r2h != null).length,
      avgReturn30m: avg("r30m"),
      avgReturn1h: avg("r1h"),
      avgReturn2h: avg("r2h"),
      positiveRate30m: hit("r30m"),
      positiveRate1h: hit("r1h"),
      positiveRate2h: hit("r2h"),
      bestReturn2h: maxReturn2h.length ? Math.max(...maxReturn2h) : null,
      worstReturn2h: worstReturn2h.length ? Math.min(...worstReturn2h) : null
    };
  });

  const avgAll = key => {
    const values = recent.map(e => finite(e[key])).filter(v => v != null);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  const rateAll = key => {
    const values = recent.map(e => finite(e[key])).filter(v => v != null);
    return values.length ? (values.filter(v => v > 0).length / values.length) * 100 : null;
  };

  return {
    generatedAt: new Date(now).toISOString(),
    totalOpportunities24h: recent.length,
    resolved30m: recent.filter(e => e.r30m != null).length,
    resolved1h: recent.filter(e => e.r1h != null).length,
    resolved2h: recent.filter(e => e.r2h != null).length,
    avgReturn30m: avgAll("r30m"),
    avgReturn1h: avgAll("r1h"),
    avgReturn2h: avgAll("r2h"),
    positiveRate30m: rateAll("r30m"),
    positiveRate1h: rateAll("r1h"),
    positiveRate2h: rateAll("r2h"),
    markets: summaries,
    events: recent.slice().sort((a, b) => b.signalAt - a.signalAt).slice(0, 500),
    scorePoints: []
  };
}

function updateEvents(state, markets, now) {
  const bySymbol = new Map(markets.map(m => [m.symbol, m]));
  for (const event of state.events) updateEvent(event, bySymbol.get(event.symbol), now);

  const latestEvent = new Map();
  for (const event of state.events) {
    if (event.signalAt > (latestEvent.get(event.symbol)?.signalAt ?? 0)) latestEvent.set(event.symbol, event);
  }

  const previousPoint = state.scorePoints[state.scorePoints.length - 1];
  for (const m of markets) {
    const previousMarket = previousPoint?.markets?.find(x => x.s === m.symbol);
    const crossed = (finite(m.score) ?? 0) >= OPPORTUNITY_SCORE &&
      (previousMarket ? (finite(previousMarket.score) ?? 0) < OPPORTUNITY_SCORE : true);
    const last = latestEvent.get(m.symbol);
    const cooledDown = !last || now - Number(last.signalAt) >= SIGNAL_COOLDOWN_MS;

    if (crossed && cooledDown) {
      const event = createEvent(m, now);
      state.events.push(event);
      latestEvent.set(m.symbol, event);
    }
  }

  const cutoff = now - WINDOW_MS;
  state.events = state.events.filter(e => Number(e.signalAt) >= cutoff);
}

function buildAnalytics(previousRaw, markets, now) {
  const state = readState(previousRaw);
  updateEvents(state, markets, now);
  addScorePoint(state, markets, now);

  const analytics = summarize(state.events, markets, now);
  analytics.scorePoints = state.scorePoints;

  return {
    state,
    public: {
      schemaVersion: 1,
      generatedAt: analytics.generatedAt,
      intervalMinutes: 5,
      scoreHistoryIntervalMinutes: 15,
      windowHours: 24,
      opportunityScoreThreshold: OPPORTUNITY_SCORE,
      markets: analytics.markets,
      events: analytics.events,
      scorePoints: analytics.scorePoints,
      summary: {
        totalOpportunities24h: analytics.totalOpportunities24h,
        resolved30m: analytics.resolved30m,
        resolved1h: analytics.resolved1h,
        resolved2h: analytics.resolved2h,
        avgReturn30m: analytics.avgReturn30m,
        avgReturn1h: analytics.avgReturn1h,
        avgReturn2h: analytics.avgReturn2h,
        positiveRate30m: analytics.positiveRate30m,
        positiveRate1h: analytics.positiveRate1h,
        positiveRate2h: analytics.positiveRate2h
      }
    }
  };
}

export { buildAnalytics, OPPORTUNITY_SCORE };
