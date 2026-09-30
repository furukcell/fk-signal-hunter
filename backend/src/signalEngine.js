function buildOpportunity(market) {
  const exchanges = Object.entries(market.exchangeData || {})
    .map(([exchange, d]) => ({ exchange, ...d }))
    .filter(x => Number.isFinite(Number(x.bid)) && Number.isFinite(Number(x.ask)) && Number(x.bid) > 0 && Number(x.ask) > 0);

  if (!exchanges.length) return null;

  let bestBuy = null;
  let bestSell = null;
  for (const x of exchanges) {
    if (!bestBuy || x.ask < bestBuy.ask) bestBuy = x;
    if (!bestSell || x.bid > bestSell.bid) bestSell = x;
  }

  const grossSpreadPct = bestBuy && bestSell && bestBuy.exchange !== bestSell.exchange
    ? ((bestSell.bid - bestBuy.ask) / bestBuy.ask) * 100
    : 0;

  const consensus = Number(market.buyConsensus || 0);
  const score = Number(market.score || 0);
  const liquidity = Number(market.quoteVolume24h || 0);

  return {
    symbol: market.symbol,
    score,
    exchangeCount: exchanges.length,
    bestBuy: bestBuy ? { exchange: bestBuy.exchange, ask: Number(bestBuy.ask) } : null,
    bestSell: bestSell ? { exchange: bestSell.exchange, bid: Number(bestSell.bid) } : null,
    grossCrossExchangeSpreadPct: grossSpreadPct,
    buyConsensus: consensus,
    liquidity24h: liquidity,
    actionable: score >= 82 && exchanges.length >= 3
  };
}

export { buildOpportunity };
