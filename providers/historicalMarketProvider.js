function calculateFallbackAthFromPair(pair) {
  const marketCap = Number(pair?.marketCap || 0);

  if (!marketCap || marketCap <= 0) return null;

  const h24 = Number(pair?.priceChange?.h24 || 0);
  const h6 = Number(pair?.priceChange?.h6 || 0);
  const h1 = Number(pair?.priceChange?.h1 || 0);
  const m5 = Number(pair?.priceChange?.m5 || 0);

  const strongestRecentMove = Math.max(h24, h6, h1, m5, 0);

  if (strongestRecentMove <= 0) {
    return Number((marketCap * 1.15).toFixed(2));
  }

  const multiplier = 1 + (strongestRecentMove / 100);
  return Number((marketCap * multiplier).toFixed(2));
}

function calculatePercentFromAth(currentMarketCap, ath) {
  if (!currentMarketCap || !ath || ath <= 0) return null;
  return Number((((currentMarketCap - ath) / ath) * 100).toFixed(1));
}

async function fetchHistoricalMarketIntelligence(bestPair) {
  try {
    const marketCap = Number(bestPair?.marketCap || 0);

    const ath = calculateFallbackAthFromPair(bestPair);
    const percentFromAth = calculatePercentFromAth(marketCap, ath);

    return {
      ath,
      percentFromAth,
      localHigh: null,
      percentFromLocalHigh: null,
      source: 'fallback-heuristic'
    };
  } catch (error) {
    console.error('[HistoricalMarketProvider] Error:', error.message);

    return {
      ath: null,
      percentFromAth: null,
      localHigh: null,
      percentFromLocalHigh: null,
      source: 'error'
    };
  }
}

module.exports = { fetchHistoricalMarketIntelligence };