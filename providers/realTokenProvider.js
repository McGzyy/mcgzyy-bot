const { fetchDexScreenerTokenData } = require('./dexScreenerProvider');

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeString(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  return str || fallback;
}

function calculateBuySellRatio(buys, sells) {
  const buyCount = toNumber(buys);
  const sellCount = toNumber(sells);

  if (buyCount <= 0 && sellCount <= 0) return null;
  if (sellCount <= 0) return buyCount > 0 ? clamp(buyCount, 1, 8) : null;

  return Number((buyCount / sellCount).toFixed(2));
}

function getTradePressureLabel(buySellRatio) {
  if (buySellRatio === null || buySellRatio === undefined) return 'Unknown';
  if (buySellRatio >= 2.2) return 'Very Bullish';
  if (buySellRatio >= 1.35) return 'Bullish';
  if (buySellRatio >= 0.9) return 'Balanced';
  if (buySellRatio >= 0.65) return 'Weak';
  return 'Bearish';
}

function getVolumeTrendLabel(volume5m, volume1h, volume24h) {
  const v5 = toNumber(volume5m);
  const v1 = toNumber(volume1h);
  const v24 = toNumber(volume24h);

  if (v5 >= 10000 || v1 >= 50000 || v24 >= 200000) return 'Very Strong';
  if (v5 >= 4000 || v1 >= 20000 || v24 >= 100000) return 'Strong';
  if (v5 >= 1500 || v1 >= 8000 || v24 >= 30000) return 'Moderate';
  if (v5 > 0 || v1 > 0 || v24 > 0) return 'Weak';

  return 'Unknown';
}

function getPriceMomentumLabel(priceChange5m, priceChange1h, priceChange24h) {
  const p5 = toNumber(priceChange5m);
  const p1 = toNumber(priceChange1h);
  const p24 = toNumber(priceChange24h);

  if (p5 >= 15 || p1 >= 35 || p24 >= 120) return 'Explosive';
  if (p5 >= 7 || p1 >= 15 || p24 >= 50) return 'Strong';
  if (p5 >= 2 || p1 >= 5 || p24 >= 15) return 'Building';
  if (p5 > 0 || p1 > 0 || p24 > 0) return 'Weak';
  if (p5 < -10 || p1 < -20 || p24 < -50) return 'Dumping';

  return 'Flat';
}

function getTradeVelocityLabel(trades5m, trades1h, trades24h) {
  const t5 = toNumber(trades5m);
  const t1 = toNumber(trades1h);
  const t24 = toNumber(trades24h);

  if (t5 >= 40 || t1 >= 180 || t24 >= 1000) return 'Very High';
  if (t5 >= 15 || t1 >= 70 || t24 >= 400) return 'High';
  if (t5 >= 5 || t1 >= 25 || t24 >= 120) return 'Moderate';
  if (t5 > 0 || t1 > 0 || t24 > 0) return 'Low';

  return 'Unknown';
}

function getWalletActivityStrength(trades5m, trades1h, trades24h) {
  const t5 = toNumber(trades5m);
  const t1 = toNumber(trades1h);
  const t24 = toNumber(trades24h);

  if (t5 >= 40 || t1 >= 180 || t24 >= 1000) return 'Very Strong';
  if (t5 >= 15 || t1 >= 70 || t24 >= 400) return 'Strong';
  if (t5 >= 5 || t1 >= 25 || t24 >= 120) return 'Moderate';
  if (t5 > 0 || t1 > 0 || t24 > 0) return 'Weak';

  return 'Unknown';
}

function getShortTermMomentum(volume5m, buySellRatio, trades5m, priceChange5m) {
  const v5 = toNumber(volume5m);
  const ratio = toNumber(buySellRatio);
  const trades = toNumber(trades5m);
  const p5 = toNumber(priceChange5m);

  if (
    (v5 >= 10000 && ratio >= 1.4) ||
    (trades >= 35 && p5 >= 8)
  ) {
    return 'Very Strong';
  }

  if (
    (v5 >= 4000 && ratio >= 1.2) ||
    (trades >= 15 && p5 >= 4)
  ) {
    return 'Strong';
  }

  if (
    (v5 >= 1500 && ratio >= 0.95) ||
    (trades >= 5 && p5 >= 1)
  ) {
    return 'Moderate';
  }

  return 'Weak';
}

/**
 * =========================
 * FALLBACK DERIVATION
 * =========================
 */

function deriveFallbackTrades(volume5m, volume1h, volume24h) {
  const v5 = toNumber(volume5m);
  const v1 = toNumber(volume1h);
  const v24 = toNumber(volume24h);

  const trades5m = v5 > 0 ? Math.max(1, Math.round(v5 / 220)) : 0;
  const trades1h = v1 > 0 ? Math.max(trades5m, Math.round(v1 / 260)) : trades5m * 4;
  const trades24h = v24 > 0 ? Math.max(trades1h, Math.round(v24 / 320)) : trades1h * 8;

  return {
    trades5m,
    trades1h,
    trades24h
  };
}

function deriveFallbackBuysSells(trades5m, trades1h, trades24h, priceChange5m = 0) {
  const p5 = toNumber(priceChange5m);

  let buyBias = 0.52;
  if (p5 >= 8) buyBias = 0.68;
  else if (p5 >= 3) buyBias = 0.6;
  else if (p5 <= -8) buyBias = 0.38;
  else if (p5 <= -3) buyBias = 0.44;

  const buys5m = Math.max(0, Math.round(trades5m * buyBias));
  const sells5m = Math.max(0, trades5m - buys5m);

  const buys1h = Math.max(0, Math.round(trades1h * buyBias));
  const sells1h = Math.max(0, trades1h - buys1h);

  const buys24h = Math.max(0, Math.round(trades24h * buyBias));
  const sells24h = Math.max(0, trades24h - buys24h);

  return {
    buys5m,
    sells5m,
    buys1h,
    sells1h,
    buys24h,
    sells24h
  };
}

function deriveFallbackAgeMinutes(ageMinutes) {
  const age = toNumber(ageMinutes, 0);
  if (age > 0) return age;
  return 15;
}

function normalizeDexData(dex, contractAddress) {
  const volume5m = toNumber(dex.market?.volume5m);
  const volume1h = toNumber(dex.market?.volume1h);
  const volume24h = toNumber(dex.market?.volume24h);

  let trades5m = toNumber(dex.market?.trades5m);
  let trades1h = toNumber(dex.market?.trades1h);
  let trades24h = toNumber(dex.market?.trades24h);

  if (!trades5m || !trades1h || !trades24h) {
    const fallbackTrades = deriveFallbackTrades(volume5m, volume1h, volume24h);
    trades5m = trades5m || fallbackTrades.trades5m;
    trades1h = trades1h || fallbackTrades.trades1h;
    trades24h = trades24h || fallbackTrades.trades24h;
  }

  let buys5m = toNumber(dex.market?.buys5m);
  let sells5m = toNumber(dex.market?.sells5m);
  let buys1h = toNumber(dex.market?.buys1h);
  let sells1h = toNumber(dex.market?.sells1h);
  let buys24h = toNumber(dex.market?.buys24h);
  let sells24h = toNumber(dex.market?.sells24h);

  const priceChange5m = toNumber(dex.market?.priceChange5m);

  if ((buys5m + sells5m) <= 0 || (buys1h + sells1h) <= 0 || (buys24h + sells24h) <= 0) {
    const fallbackFlow = deriveFallbackBuysSells(trades5m, trades1h, trades24h, priceChange5m);

    buys5m = buys5m || fallbackFlow.buys5m;
    sells5m = sells5m || fallbackFlow.sells5m;
    buys1h = buys1h || fallbackFlow.buys1h;
    sells1h = sells1h || fallbackFlow.sells1h;
    buys24h = buys24h || fallbackFlow.buys24h;
    sells24h = sells24h || fallbackFlow.sells24h;
  }

  const buySellRatio5m = calculateBuySellRatio(buys5m, sells5m);
  const buySellRatio1h = calculateBuySellRatio(buys1h, sells1h);
  const buySellRatio24h = calculateBuySellRatio(buys24h, sells24h);

  const tradePressure = getTradePressureLabel(buySellRatio5m);
  const volumeTrend = getVolumeTrendLabel(volume5m, volume1h, volume24h);

  const priceMomentum = getPriceMomentumLabel(
    dex.market?.priceChange5m,
    dex.market?.priceChange1h,
    dex.market?.priceChange24h
  );

  const tradeVelocity = getTradeVelocityLabel(
    trades5m,
    trades1h,
    trades24h
  );

  const walletActivityStrength = getWalletActivityStrength(
    trades5m,
    trades1h,
    trades24h
  );

  const shortTermMomentum = getShortTermMomentum(
    volume5m,
    buySellRatio5m,
    trades5m,
    dex.market?.priceChange5m
  );

  return {
    token: {
      tokenName: safeString(dex.token?.tokenName, 'Unknown Token'),
      ticker: safeString(dex.token?.ticker, 'UNKNOWN'),
      contractAddress: safeString(dex.token?.contractAddress, contractAddress),
      pairAddress: safeString(dex.token?.pairAddress, null),
      website: safeString(dex.token?.website, null),
      twitter: safeString(dex.token?.twitter, null),
      telegram: safeString(dex.token?.telegram, null),
      launchPlatform: safeString(dex.token?.launchPlatform, 'Unknown'),
      description: null,
      logoURI: safeString(dex.token?.imageUrl, null),
      discord: null,
      tags: [],
      coingeckoId: null
    },

    market: {
      marketCap: toNumber(dex.market?.marketCap),
      liquidity: toNumber(dex.market?.liquidity),
      volume5m,
      volume15m: 0,
      volume1h,
      volume24h,
      ageMinutes: deriveFallbackAgeMinutes(dex.market?.ageMinutes),

      ath: null,
      percentFromAth: null,

      price: dex.market?.priceUsd || null,
      fdv: toNumber(dex.market?.fdv),
      circulatingSupply: null,
      totalSupply: null,
      holders: dex.market?.holders ?? null,

      priceChange5m: toNumber(dex.market?.priceChange5m),
      priceChange15m: 0,
      priceChange30m: 0,
      priceChange1h: toNumber(dex.market?.priceChange1h),
      priceChange2h: 0,
      priceChange4h: 0,
      priceChange8h: 0,
      priceChange24h: toNumber(dex.market?.priceChange24h),

      trades5m,
      trades15m: 0,
      trades30m: 0,
      trades1h,
      trades2h: 0,
      trades4h: 0,
      trades8h: 0,
      trades24h,

      buyVolume5m: null,
      buyVolume15m: null,
      buyVolume30m: null,
      buyVolume1h: null,
      buyVolume2h: null,
      buyVolume4h: null,
      buyVolume8h: null,
      buyVolume24h: null,

      sellVolume5m: null,
      sellVolume15m: null,
      sellVolume30m: null,
      sellVolume1h: null,
      sellVolume2h: null,
      sellVolume4h: null,
      sellVolume8h: null,
      sellVolume24h: null
    },

    holders: {
      holders: dex.market?.holders ?? null,
      top10HolderPercent: null,
      devHoldingPercent: null,
      bundleHoldingPercent: null,
      sniperPercent: null,

      smartWallets: null,
      freshWallets: null,
      snipers: null,
      walletQuality: 'Unknown',
      concentrationRisk: 'Unknown',
      walletClusterRisk: 'Unknown',
      insiderRisk: 'Unknown',
      source: 'none'
    },

    socials: {
      dexPaid: !!dex.socials?.dexPaid,
      websiteLive: !!dex.socials?.websiteLive
    },

    tradeSignals: {
      buys5m,
      sells5m,
      buys15m: 0,
      sells15m: 0,
      buys1h,
      sells1h,
      buys24h,
      sells24h,

      buySellRatio5m,
      buySellRatio15m: null,
      buySellRatio1h,
      buySellRatio24h,

      tradePressure,
      shortTermMomentum,
      volumeTrend,
      priceMomentum,
      tradeVelocity
    },

    walletSignals: {
      uniqueWallets5m: null,
      uniqueWallets15m: null,
      uniqueWallets1h: null,
      uniqueWallets24h: null,
      walletActivityStrength
    },

    meta: {
      migrated: !!dex.meta?.migrated,
      source: 'dexscreener-normalized'
    },

    birdeye: null
  };
}

function buildFallbackErrorObject(contractAddress) {
  return {
    token: {
      tokenName: 'Unknown Token',
      ticker: 'UNKNOWN',
      contractAddress,
      pairAddress: null,
      website: null,
      twitter: null,
      telegram: null,
      launchPlatform: 'Unknown',
      description: null,
      logoURI: null,
      discord: null,
      tags: [],
      coingeckoId: null
    },

    market: {
      marketCap: 0,
      liquidity: 0,
      volume5m: 0,
      volume15m: 0,
      volume1h: 0,
      volume24h: 0,
      ageMinutes: null,

      ath: null,
      percentFromAth: null,

      price: null,
      fdv: 0,
      circulatingSupply: null,
      totalSupply: null,
      holders: null,

      priceChange5m: 0,
      priceChange15m: 0,
      priceChange30m: 0,
      priceChange1h: 0,
      priceChange2h: 0,
      priceChange4h: 0,
      priceChange8h: 0,
      priceChange24h: 0,

      trades5m: 0,
      trades15m: 0,
      trades30m: 0,
      trades1h: 0,
      trades2h: 0,
      trades4h: 0,
      trades8h: 0,
      trades24h: 0,

      buyVolume5m: null,
      buyVolume15m: null,
      buyVolume30m: null,
      buyVolume1h: null,
      buyVolume2h: null,
      buyVolume4h: null,
      buyVolume8h: null,
      buyVolume24h: null,

      sellVolume5m: null,
      sellVolume15m: null,
      sellVolume30m: null,
      sellVolume1h: null,
      sellVolume2h: null,
      sellVolume4h: null,
      sellVolume8h: null,
      sellVolume24h: null
    },

    holders: {
      holders: null,
      top10HolderPercent: null,
      devHoldingPercent: null,
      bundleHoldingPercent: null,
      sniperPercent: null,
      smartWallets: null,
      freshWallets: null,
      snipers: null,
      walletQuality: 'Unknown',
      concentrationRisk: 'Unknown',
      walletClusterRisk: 'Unknown',
      insiderRisk: 'Unknown',
      source: 'error'
    },

    socials: {
      dexPaid: false,
      websiteLive: false
    },

    tradeSignals: {
      buys5m: 0,
      sells5m: 0,
      buys15m: 0,
      sells15m: 0,
      buys1h: 0,
      sells1h: 0,
      buys24h: 0,
      sells24h: 0,

      buySellRatio5m: null,
      buySellRatio15m: null,
      buySellRatio1h: null,
      buySellRatio24h: null,

      tradePressure: 'Unknown',
      shortTermMomentum: 'Weak',
      volumeTrend: 'Unknown',
      priceMomentum: 'Flat',
      tradeVelocity: 'Unknown'
    },

    walletSignals: {
      uniqueWallets5m: null,
      uniqueWallets15m: null,
      uniqueWallets1h: null,
      uniqueWallets24h: null,
      walletActivityStrength: 'Unknown'
    },

    meta: {
      migrated: false,
      source: 'error'
    },

    birdeye: null
  };
}

async function fetchRealTokenData(contractAddress) {
  try {
    const dex = await fetchDexScreenerTokenData(contractAddress);

    return normalizeDexData(dex, contractAddress);
  } catch (error) {
    console.error('[RealTokenProvider] Error:', error.message);
    return buildFallbackErrorObject(contractAddress);
  }
}

module.exports = { fetchRealTokenData };