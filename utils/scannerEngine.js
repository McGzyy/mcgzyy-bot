const { randomUUID } = require('crypto');
const { fetchRealTokenData } = require('../providers/realTokenProvider');
const { computeMigrated } = require('./solanaPoolMigrated');

/**
 * =========================
 * BASIC HELPERS
 * =========================
 */

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function chance(prob) {
  return Math.random() < prob;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function cleanString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  return str || fallback;
}

/**
 * =========================
 * GENERIC HELPERS
 * =========================
 */

function getGrade(score) {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function getStatus(score) {
  if (score >= 80) return 'Strong Candidate';
  if (score >= 65) return 'Good watch / possible entry';
  if (score >= 50) return 'Watchlist';
  return 'Risky';
}

function getConviction(score) {
  if (score >= 80) return 'High';
  if (score >= 65) return 'Medium-High';
  if (score >= 50) return 'Medium';
  return 'Low';
}

function getAlertType(score) {
  if (score >= 80) return '🔥 Strong Setup';
  if (score >= 65) return '⚡ Moderate Setup';
  if (score >= 50) return '📡 Watchlist';
  return '⚠️ Risky';
}

function getTradeQualityLabel(buySellRatio5m, volume5m) {
  const ratio = toNumber(buySellRatio5m);
  const vol5 = toNumber(volume5m);

  if (ratio >= 1.8 && vol5 >= 10000) return 'High';
  if (ratio >= 1.2 && vol5 >= 5000) return 'Good';
  if (vol5 < 2000) return 'Low';
  return 'Moderate';
}

function getMomentumLabel(volume5m, buySellRatio5m, volumeTrend, priceChange5m = 0) {
  const vol5 = toNumber(volume5m);
  const ratio = toNumber(buySellRatio5m);
  const price5 = toNumber(priceChange5m);

  let score = 0;

  if (vol5 >= 15000) score += 3;
  else if (vol5 >= 7000) score += 2;
  else if (vol5 >= 3000) score += 1;

  if (ratio >= 1.8) score += 3;
  else if (ratio >= 1.2) score += 2;
  else if (ratio >= 1.0) score += 1;
  else if (ratio > 0 && ratio < 0.8) score -= 2;

  if (volumeTrend === 'Very Strong') score += 2;
  else if (volumeTrend === 'Strong') score += 1;
  else if (volumeTrend === 'Weak') score -= 1;

  if (price5 >= 12) score += 2;
  else if (price5 >= 5) score += 1;
  else if (price5 <= -10) score -= 2;

  if (score >= 7) return 'Very Strong';
  if (score >= 4) return 'Strong';
  if (score >= 2) return 'Moderate';
  if (score <= -1) return 'Weak';
  return 'Neutral';
}

function getRiskLabel(liquidity, buySellRatio5m, ageMinutes) {
  let risk = 0;

  const liq = toNumber(liquidity);
  const ratio = toNumber(buySellRatio5m);
  const age = toNumber(ageMinutes);

  if (liq < 5000) risk += 2;
  else if (liq < 10000) risk += 1;

  if (ratio > 0 && ratio < 0.8) risk += 2;
  else if (ratio > 0 && ratio < 1.0) risk += 1;

  if (age > 180) risk += 1;

  if (risk >= 4) return 'High';
  if (risk >= 2) return 'Moderate';
  return 'Low';
}

function calculateScore({
  marketCap = 0,
  liquidity = 0,
  volume5m = 0,
  ageMinutes = 0,
  buySellRatio5m = 0,
  tradePressure = 'Unknown',
  volumeTrend = 'Unknown',
  hasWebsite = false,
  hasTwitter = false,
  hasTelegram = false,
  dexPaid = false,
  migrated = false
}) {
  let score = 50;

  if (liquidity > 50000) score += 15;
  else if (liquidity > 20000) score += 10;
  else if (liquidity < 5000) score -= 10;

  if (volume5m > 20000) score += 15;
  else if (volume5m > 10000) score += 10;
  else if (volume5m < 2000) score -= 10;

  if (ageMinutes > 0 && ageMinutes < 30) score += 10;
  else if (ageMinutes > 300) score -= 10;

  if (marketCap > 50000 && marketCap < 500000) score += 10;
  if (marketCap < 10000) score -= 10;

  if (buySellRatio5m >= 1.8) score += 12;
  else if (buySellRatio5m >= 1.25) score += 8;
  else if (buySellRatio5m > 0 && buySellRatio5m < 0.8) score -= 10;

  if (tradePressure === 'Very Bullish') score += 8;
  else if (tradePressure === 'Bullish') score += 5;
  else if (tradePressure === 'Bearish' || tradePressure === 'Very Bearish') score -= 8;

  if (volumeTrend === 'Very Strong') score += 8;
  else if (volumeTrend === 'Strong') score += 5;
  else if (volumeTrend === 'Weak') score -= 5;

  if (hasWebsite) score += 5;
  if (hasTwitter) score += 5;
  if (hasTelegram) score += 5;
  if (dexPaid) score += 5;
  if (migrated) score += 3;

  return Math.max(0, Math.min(100, score));
}

function buildFlags({ liquidity, volume5m, volume1h, tradePressure, dexPaid }) {
  const greenFlags = [];
  const redFlags = [];

  if (liquidity >= 20000) greenFlags.push('Strong liquidity');
  else if (liquidity < 5000) redFlags.push('Weak liquidity');

  if (volume5m >= 5000) greenFlags.push('Strong 5m volume');
  if (volume1h >= 15000) greenFlags.push('1h volume building');

  if (tradePressure === 'Bullish' || tradePressure === 'Very Bullish') {
    greenFlags.push('Buy pressure strong');
  } else if (tradePressure === 'Bearish') {
    redFlags.push('Sell pressure showing');
  }

  if (!dexPaid) {
    redFlags.push('Not Dex Paid');
  }

  return { greenFlags, redFlags };
}

/**
 * =========================
 * FALLBACK TRADE SIGNALS
 * =========================
 */

function deriveBuySellRatio(volume5m, volume1h, priceChange5m) {
  const vol5 = toNumber(volume5m);
  const vol1 = toNumber(volume1h);
  const price5 = toNumber(priceChange5m);

  if (vol5 <= 0 && vol1 <= 0) return 0.85;

  let ratio = 1.0;

  if (vol5 >= 15000) ratio += 0.35;
  else if (vol5 >= 7000) ratio += 0.2;
  else if (vol5 < 1000) ratio -= 0.15;

  if (vol1 >= vol5 * 3 && vol5 > 0) ratio += 0.2;
  if (price5 >= 8) ratio += 0.3;
  else if (price5 >= 3) ratio += 0.15;
  else if (price5 <= -8) ratio -= 0.25;

  return Number(Math.max(0.55, Math.min(3.25, ratio)).toFixed(2));
}

function deriveTradePressure(ratio) {
  const r = toNumber(ratio);

  if (r >= 2.2) return 'Very Bullish';
  if (r >= 1.35) return 'Bullish';
  if (r >= 0.9) return 'Balanced';
  return 'Bearish';
}

function deriveVolumeTrend(volume5m, volume1h) {
  const vol5 = toNumber(volume5m);
  const vol1 = toNumber(volume1h);

  if (vol5 <= 0 && vol1 <= 0) return 'Unknown';
  if (vol1 >= vol5 * 5 && vol5 > 0) return 'Very Strong';
  if (vol1 >= vol5 * 2 && vol5 > 0) return 'Strong';
  if (vol1 > 0 && vol1 < vol5) return 'Weak';
  return 'Neutral';
}

/**
 * =========================
 * GECKO FALLBACK MERGE
 * =========================
 */

function mergeRealDataWithCandidate(realData, candidate, contractAddress) {
  if (!candidate) return realData;

  const merged = JSON.parse(JSON.stringify(realData || {}));

  merged.token = merged.token || {};
  merged.market = merged.market || {};
  merged.tradeSignals = merged.tradeSignals || {};
  merged.socials = merged.socials || {};
  merged.meta = merged.meta || {};

  if (!merged.token.contractAddress) {
    merged.token.contractAddress = contractAddress;
  }

  // ✅ Preserve pair address for Axiom / pair-based tools
  if (!merged.token.pairAddress && candidate.pairAddress) {
    merged.token.pairAddress = candidate.pairAddress;
  }

  if (!merged.token.tokenName || merged.token.tokenName === 'Unknown Token') {
    merged.token.tokenName = candidate.poolName || merged.token.tokenName || 'Unknown Token';
  }

  if (!merged.market.marketCap || merged.market.marketCap <= 0) {
    merged.market.marketCap = toNumber(candidate.marketCap);
  }

  if (!merged.market.liquidity || merged.market.liquidity <= 0) {
    merged.market.liquidity = toNumber(candidate.liquidity);
  }

  if (!merged.market.volume5m || merged.market.volume5m <= 0) {
    merged.market.volume5m = toNumber(candidate.volume5m);
  }

  if (!merged.market.volume1h || merged.market.volume1h <= 0) {
    merged.market.volume1h = toNumber(candidate.volume1h);
  }

  if (!merged.market.volume24h || merged.market.volume24h <= 0) {
    merged.market.volume24h = toNumber(candidate.volume24h);
  }

  if (!merged.market.priceChange5m && candidate.priceChange5m !== undefined) {
    merged.market.priceChange5m = toNumber(candidate.priceChange5m);
  }

  if (!merged.market.priceChange1h && candidate.priceChange1h !== undefined) {
    merged.market.priceChange1h = toNumber(candidate.priceChange1h);
  }

  if (!merged.market.priceChange24h && candidate.priceChange24h !== undefined) {
    merged.market.priceChange24h = toNumber(candidate.priceChange24h);
  }

  if (!merged.market.ageMinutes || merged.market.ageMinutes <= 0) {
    if (candidate.createdAt) {
      const created = new Date(candidate.createdAt).getTime();
      if (Number.isFinite(created) && created > 0) {
        merged.market.ageMinutes = Math.floor((Date.now() - created) / (1000 * 60));
      }
    }
  }

  if (!merged.tradeSignals.buys5m && candidate.buys5m !== undefined) {
    merged.tradeSignals.buys5m = toNumber(candidate.buys5m);
  }

  if (!merged.tradeSignals.sells5m && candidate.sells5m !== undefined) {
    merged.tradeSignals.sells5m = toNumber(candidate.sells5m);
  }

  if (!merged.tradeSignals.buySellRatio5m || merged.tradeSignals.buySellRatio5m <= 0) {
    const buys = toNumber(merged.tradeSignals.buys5m);
    const sells = toNumber(merged.tradeSignals.sells5m);

    if (buys > 0 && sells > 0) {
      merged.tradeSignals.buySellRatio5m = Number((buys / sells).toFixed(2));
    }
  }

  const geckoImg =
    candidate.geckoImageUrl != null ? String(candidate.geckoImageUrl).trim() : '';
  if (geckoImg) {
    merged.token = merged.token || {};
    const existing =
      merged.token.geckoImageUrl != null ? String(merged.token.geckoImageUrl).trim() : '';
    if (!existing) merged.token.geckoImageUrl = geckoImg;
  }

  merged.meta = merged.meta || {};
  merged.meta.migrated = computeMigrated({
    dexId: merged.token?.launchPlatform,
    geckoDexName: candidate.dexId,
    liquidityUsd: toNumber(merged.market?.liquidity),
    marketCapUsd: toNumber(merged.market?.marketCap),
    ageMinutes: toNumber(merged.market?.ageMinutes),
    volume24h: toNumber(merged.market?.volume24h)
  });

  return merged;
}

/**
 * =========================
 * SCAN BUILDER
 * =========================
 */

function buildScanObject(base) {
  const score = calculateScore({
    marketCap: base.marketCap,
    liquidity: base.liquidity,
    volume5m: base.volume5m,
    ageMinutes: base.ageMinutes,
    buySellRatio5m: base.buySellRatio5m,
    tradePressure: base.tradePressure,
    volumeTrend: base.volumeTrend,
    hasWebsite: !!base.website,
    hasTwitter: !!base.twitter,
    hasTelegram: !!base.telegram,
    dexPaid: !!base.dexPaid,
    migrated: !!base.migrated
  });

  const { greenFlags, redFlags } = buildFlags({
    liquidity: base.liquidity,
    volume5m: base.volume5m,
    volume1h: base.volume1h,
    tradePressure: base.tradePressure,
    dexPaid: base.dexPaid
  });

  return {
    id: randomUUID(),

    contractAddress: base.contractAddress,
    pairAddress: base.pairAddress || null,
    tokenName: base.tokenName,
    ticker: base.ticker,

    website: base.website || null,
    twitter: base.twitter || null,
    telegram: base.telegram || null,

    marketCap: toNumber(base.marketCap),
    liquidity: toNumber(base.liquidity),
    volume5m: toNumber(base.volume5m),
    volume1h: toNumber(base.volume1h),
    volume24h: toNumber(base.volume24h),
    ageMinutes: Math.round(toNumber(base.ageMinutes)),

    priceChange5m: toNumber(base.priceChange5m),

    trades5m: Math.round(toNumber(base.trades5m)),
    trades1h: Math.round(toNumber(base.trades1h)),
    trades24h: Math.round(toNumber(base.trades24h)),

    buys5m: Math.round(toNumber(base.buys5m)),
    sells5m: Math.round(toNumber(base.sells5m)),
    buys1h: Math.round(toNumber(base.buys1h)),
    sells1h: Math.round(toNumber(base.sells1h)),
    buys24h: Math.round(toNumber(base.buys24h)),
    sells24h: Math.round(toNumber(base.sells24h)),

    buySellRatio5m: Number(toNumber(base.buySellRatio5m).toFixed(2)),
    buySellRatio1h: Number(toNumber(base.buySellRatio1h).toFixed(2)),
    tradePressure: cleanString(base.tradePressure, 'Unknown'),
    volumeTrend: cleanString(base.volumeTrend, 'Unknown'),

    entryScore: score,
    grade: getGrade(score),
    status: getStatus(score),
    conviction: getConviction(score),
    alertType: getAlertType(score),

    momentum: getMomentumLabel(
      base.volume5m,
      base.buySellRatio5m,
      base.volumeTrend,
      base.priceChange5m
    ),

    riskLevel: getRiskLabel(base.liquidity, base.buySellRatio5m, base.ageMinutes),
    tradeQuality: getTradeQualityLabel(base.buySellRatio5m, base.volume5m),

    dexPaid: !!base.dexPaid,
    migrated: !!base.migrated,

    ...(Number(base.pairCreatedAt) > 0
      ? { pairCreatedAt: Math.round(Number(base.pairCreatedAt)) }
      : {}),

    holders: base.holders ?? null,

    greenFlags,
    redFlags,

    ...(toNumber(base.priceUsd) > 0 ? { priceUsd: toNumber(base.priceUsd) } : {}),

    ...(() => {
      const t = {};
      if (base.tokenImageUrl && String(base.tokenImageUrl).trim()) {
        t.imageUrl = String(base.tokenImageUrl).trim();
      }
      if (base.geckoTokenImageUrl && String(base.geckoTokenImageUrl).trim()) {
        t.geckoImageUrl = String(base.geckoTokenImageUrl).trim();
      }
      return Object.keys(t).length ? { token: t } : {};
    })()
  };
}

/**
 * =========================
 * FAKE TOKEN GENERATOR
 * =========================
 */

function generateMockToken(contractAddress = null) {
  return {
    contractAddress: contractAddress || randomUUID().replace(/-/g, '').slice(0, 44),
    pairAddress: randomUUID().replace(/-/g, '').slice(0, 44),
    tokenName: pick(['PepeX', 'SolCat', 'MoonAI', 'Bonkify', 'FrogVerse']),
    ticker: pick(['PEPX', 'SCAT', 'MAI', 'BONK', 'FROG']),
    website: chance(0.4) ? 'https://example.com' : null,
    twitter: chance(0.5) ? 'https://twitter.com/example' : null,
    telegram: chance(0.3) ? 'https://t.me/example' : null
  };
}

function generateMarketData() {
  const marketCap = rand(5000, 150000);
  const liquidity = rand(2000, 80000);
  const volume5m = rand(500, 30000);
  const volume1h = volume5m * rand(2, 10);
  const ageMinutes = rand(1, 180);

  return {
    marketCap,
    liquidity,
    volume5m,
    volume1h,
    ageMinutes,
    priceChange5m: rand(-8, 18)
  };
}

function generateTradeSignals(market) {
  const buySellRatio5m = rand(0.5, 3.5);
  const buySellRatio1h = rand(0.5, 5);

  let tradePressure = 'Balanced';

  if (buySellRatio5m >= 2) tradePressure = 'Very Bullish';
  else if (buySellRatio5m >= 1.3) tradePressure = 'Bullish';
  else if (buySellRatio5m <= 0.7) tradePressure = 'Bearish';

  let volumeTrend = 'Neutral';

  if (market.volume1h > market.volume5m * 5) volumeTrend = 'Very Strong';
  else if (market.volume1h > market.volume5m * 2) volumeTrend = 'Strong';
  else if (market.volume1h < market.volume5m) volumeTrend = 'Weak';

  return {
    buySellRatio5m,
    buySellRatio1h,
    tradePressure,
    volumeTrend
  };
}

/**
 * =========================
 * FAKE SCAN
 * =========================
 */

async function generateSimulatedScan(contractAddress = null) {
  const token = generateMockToken(contractAddress);
  const market = generateMarketData();
  const trade = generateTradeSignals(market);
  const priceUsd = Math.max(1e-12, market.marketCap / rand(1e8, 1e10));

  return buildScanObject({
    contractAddress: token.contractAddress,
    pairAddress: token.pairAddress,
    tokenName: token.tokenName,
    ticker: token.ticker,
    website: token.website,
    twitter: token.twitter,
    telegram: token.telegram,

    marketCap: market.marketCap,
    liquidity: market.liquidity,
    volume5m: market.volume5m,
    volume1h: market.volume1h,
    ageMinutes: market.ageMinutes,
    priceChange5m: market.priceChange5m,

    buySellRatio5m: trade.buySellRatio5m,
    buySellRatio1h: trade.buySellRatio1h,
    tradePressure: trade.tradePressure,
    volumeTrend: trade.volumeTrend,

    dexPaid: chance(0.5),
    migrated: chance(0.2),
    holders: chance(0.5) ? Math.floor(rand(50, 500)) : null,

    priceUsd
  });
}

/**
 * =========================
 * REAL SCAN
 * =========================
 */

async function generateRealScan(contractAddress, geckoCandidate = null) {
  try {
    let realData = await fetchRealTokenData(contractAddress);

    if (geckoCandidate) {
      realData = mergeRealDataWithCandidate(realData, geckoCandidate, contractAddress);
    }

    if (!realData || !realData.market) {
      return null;
    }

    const marketCap = toNumber(realData.market?.marketCap);
    // DexScreener/network errors use `buildFallbackErrorObject` (meta.source === 'error', mc 0).
    // Do not return a normal scan for that path — monitoring treats mc<=0 as "bad coin" strikes.
    if (String(realData.meta?.source || '') === 'error' && (!Number.isFinite(marketCap) || marketCap <= 0)) {
      return { __monitorProviderSkip: true };
    }
    const liquidity = toNumber(realData.market?.liquidity);
    const volume5m = toNumber(realData.market?.volume5m);
    const volume1h = toNumber(realData.market?.volume1h);
    const volume24h = toNumber(realData.market?.volume24h);
    const ageMinutes = toNumber(realData.market?.ageMinutes);
    const priceChange5m = toNumber(realData.market?.priceChange5m);

    const trades5m = toNumber(realData.market?.trades5m);
    const trades1h = toNumber(realData.market?.trades1h);
    const trades24h = toNumber(realData.market?.trades24h);

    let buySellRatio5m = toNumber(realData.tradeSignals?.buySellRatio5m);
    let buySellRatio1h = toNumber(realData.tradeSignals?.buySellRatio1h);
    let tradePressure = cleanString(realData.tradeSignals?.tradePressure);
    let volumeTrend = cleanString(realData.tradeSignals?.volumeTrend);

    const buys5m = toNumber(realData.tradeSignals?.buys5m);
    const sells5m = toNumber(realData.tradeSignals?.sells5m);
    const buys1h = toNumber(realData.tradeSignals?.buys1h);
    const sells1h = toNumber(realData.tradeSignals?.sells1h);
    const buys24h = toNumber(realData.tradeSignals?.buys24h);
    const sells24h = toNumber(realData.tradeSignals?.sells24h);

    if (!buySellRatio5m || buySellRatio5m <= 0) {
      buySellRatio5m = deriveBuySellRatio(volume5m, volume1h, priceChange5m);
    }

    if (!buySellRatio1h || buySellRatio1h <= 0) {
      buySellRatio1h = Number((buySellRatio5m * 1.08).toFixed(2));
    }

    if (!tradePressure || tradePressure === 'Unknown') {
      tradePressure = deriveTradePressure(buySellRatio5m);
    }

    if (!volumeTrend || volumeTrend === 'Unknown') {
      volumeTrend = deriveVolumeTrend(volume5m, volume1h);
    }

    return buildScanObject({
      contractAddress: cleanString(realData.token?.contractAddress, contractAddress),
      pairAddress: cleanString(realData.token?.pairAddress, geckoCandidate?.pairAddress || ''),
      tokenName: cleanString(realData.token?.tokenName, 'Unknown Token'),
      ticker: cleanString(realData.token?.ticker, 'UNKNOWN'),
      website: realData.token?.website || null,
      twitter: realData.token?.twitter || null,
      telegram: realData.token?.telegram || null,
      tokenImageUrl: cleanString(
        realData.token?.imageUrl || realData.token?.logoURI,
        ''
      ),
      geckoTokenImageUrl: cleanString(realData.token?.geckoImageUrl || '', ''),

      marketCap,
      liquidity,
      volume5m,
      volume1h,
      volume24h,
      ageMinutes,
      priceChange5m,

      trades5m,
      trades1h,
      trades24h,

      buys5m,
      sells5m,
      buys1h,
      sells1h,
      buys24h,
      sells24h,

      buySellRatio5m,
      buySellRatio1h,
      tradePressure,
      volumeTrend,

      dexPaid: !!realData.socials?.dexPaid,
      migrated: !!realData.meta?.migrated,
      pairCreatedAt: toNumber(realData.market?.pairCreatedAt),
      holders: realData.holders?.holders ?? null,

      priceUsd: toNumber(realData.market?.price)
    });
  } catch (err) {
    return null;
  }
}

/**
 * =========================
 * PUBLIC ENTRY POINT
 * =========================
 */

async function generateFakeScan(contractAddress = null) {
  if (contractAddress) {
    return await generateRealScan(contractAddress);
  }

  return await generateSimulatedScan();
}

/**
 * =========================
 * AUTO SCAN (SIMULATED)
 * =========================
 */

function passesAutoFilter(scan, profile) {
  if (profile === 'conservative') {
    return scan.entryScore >= 75 && scan.liquidity >= 20000;
  }

  if (profile === 'aggressive') {
    return scan.entryScore >= 55;
  }

  return scan.entryScore >= 65;
}

async function generateBatchScans(count = 5, profile = 'balanced') {
  const results = [];

  for (let i = 0; i < count * 3; i++) {
    const scan = await generateSimulatedScan();

    if (passesAutoFilter(scan, profile)) {
      results.push({
        ...scan,
        autoAlertProfile: profile,
        autoAlertPassReasons: [
          `Score ${scan.entryScore}`,
          `Liquidity ${Math.round(scan.liquidity)}`
        ]
      });
    }

    if (results.length >= count) break;
  }

  return results;
}

module.exports = {
  generateFakeScan,
  generateRealScan,
  generateBatchScans
};