const axios = require('axios');

function logDebug(stage, payload) {
  console.log(`\n[DEXSCREENER DEBUG] ${stage}`);
  console.log(JSON.stringify(payload, null, 2));
}

function getBestPair(pairs = []) {
  if (!pairs.length) return null;

  return pairs.sort((a, b) => {
    const liqA = Number(a?.liquidity?.usd || 0);
    const liqB = Number(b?.liquidity?.usd || 0);

    const volA = Number(a?.volume?.h24 || 0);
    const volB = Number(b?.volume?.h24 || 0);

    const scoreA = liqA + (volA * 0.3);
    const scoreB = liqB + (volB * 0.3);

    return scoreB - scoreA;
  })[0];
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function calculateBuySellRatio(buys, sells) {
  if (!sells || sells === 0) return buys > 0 ? 2 : 1;
  return Number((buys / sells).toFixed(2));
}

function getTradePressure(buys, sells) {
  if (buys > sells * 1.8) return 'Very Bullish';
  if (buys > sells * 1.2) return 'Bullish';
  if (sells > buys * 1.8) return 'Very Bearish';
  if (sells > buys * 1.2) return 'Bearish';
  return 'Neutral';
}

function getVolumeTrend(vol5, vol15, vol1h) {
  if (vol5 > vol15 * 0.6) return 'Very Strong';
  if (vol5 > vol15 * 0.35) return 'Strong';
  if (vol5 < vol15 * 0.15) return 'Weak';
  return 'Normal';
}

function getPriceMomentum(change5m) {
  if (change5m >= 20) return 'Explosive';
  if (change5m >= 8) return 'Strong';
  if (change5m <= -15) return 'Dumping';
  return 'Flat';
}

async function fetchBirdeyeData(contractAddress) {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`;

    const response = await axios.get(url);
    const pairs = response.data?.pairs || [];

    if (!pairs.length) {
      logDebug('NO PAIRS', { contractAddress });
      return null;
    }

    const bestPair = getBestPair(pairs);

    if (!bestPair) {
      logDebug('NO BEST PAIR', { contractAddress });
      return null;
    }

    const liquidity = safeNumber(bestPair?.liquidity?.usd);
    const marketCap = safeNumber(bestPair?.fdv || bestPair?.marketCap);
    const volume5m = safeNumber(bestPair?.volume?.m5);
    const volume1h = safeNumber(bestPair?.volume?.h1);
    const volume24h = safeNumber(bestPair?.volume?.h24);

    const buys5m = safeNumber(bestPair?.txns?.m5?.buys);
    const sells5m = safeNumber(bestPair?.txns?.m5?.sells);

    const buys1h = safeNumber(bestPair?.txns?.h1?.buys);
    const sells1h = safeNumber(bestPair?.txns?.h1?.sells);

    const priceChange5m = safeNumber(bestPair?.priceChange?.m5);

    const buySellRatio5m = calculateBuySellRatio(buys5m, sells5m);
    const buySellRatio1h = calculateBuySellRatio(buys1h, sells1h);

    const tradePressure = getTradePressure(buys5m, sells5m);
    const volumeTrend = getVolumeTrend(volume5m, volume1h, volume24h);
    const priceMomentum = getPriceMomentum(priceChange5m);

    logDebug('DEXSCREENER SUCCESS', {
      contractAddress,
      liquidity,
      marketCap,
      volume5m,
      buys5m,
      sells5m,
      buySellRatio5m
    });

    return {
      market: {
        marketCap,
        liquidity,
        volume5m,
        volume15m: volume5m * 3, // approximation
        volume1h,
        ageMinutes: null
      },
      tradeSignals: {
        buySellRatio5m,
        buySellRatio15m: buySellRatio5m,
        buySellRatio1h,
        tradePressure,
        shortTermMomentum: volume5m > 8000 ? 'Strong' : 'Weak',
        volumeTrend,
        priceMomentum,
        tradeVelocity: buys5m + sells5m > 50 ? 'High' : 'Normal'
      },
      socials: {
        dexPaid: false,
        websiteLive: !!bestPair?.info?.website
      },
      token: {
        tokenName: bestPair?.baseToken?.name,
        ticker: bestPair?.baseToken?.symbol,
        contractAddress
      },
      meta: {
        migrated: false
      }
    };

  } catch (error) {
    console.error('[DexScreenerProvider] Error:', error.message);
    logDebug('ERROR', { contractAddress, error: error.message });
    return null;
  }
}

module.exports = {
  fetchBirdeyeData
};