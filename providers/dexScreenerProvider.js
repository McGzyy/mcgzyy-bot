const axios = require('axios');
const { computeMigrated } = require('../utils/solanaPoolMigrated');

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function safeString(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  return str || fallback;
}

function getAgeMinutes(pairCreatedAt) {
  if (!pairCreatedAt) return null;

  const created = Number(pairCreatedAt);
  if (!Number.isFinite(created) || created <= 0) return null;

  return Math.floor((Date.now() - created) / (1000 * 60));
}

function extractSocialLink(socials = [], type) {
  if (!Array.isArray(socials)) return null;

  return (
    socials.find(s => String(s?.type || '').toLowerCase() === type)?.url || null
  );
}

function isLikelySolQuote(symbol = '') {
  const clean = String(symbol || '').toUpperCase().trim();
  return ['SOL', 'WSOL'].includes(clean);
}

function isLikelyStableQuote(symbol = '') {
  const clean = String(symbol || '').toUpperCase().trim();
  return ['USDC', 'USDT'].includes(clean);
}

/**
 * =========================
 * PAIR QUALITY SCORE
 * =========================
 */

function getPairScore(pair, targetContractAddress = null) {
  const liq = toNumber(pair?.liquidity?.usd);
  const vol24 = toNumber(pair?.volume?.h24);
  const vol1 = toNumber(pair?.volume?.h1);
  const mc = toNumber(pair?.marketCap);
  const fdv = toNumber(pair?.fdv);

  const buys5m = toNumber(pair?.txns?.m5?.buys);
  const sells5m = toNumber(pair?.txns?.m5?.sells);
  const buys1h = toNumber(pair?.txns?.h1?.buys);
  const sells1h = toNumber(pair?.txns?.h1?.sells);

  const txScore = (buys5m + sells5m) * 120 + (buys1h + sells1h) * 30;

  const quoteSymbol = safeString(pair?.quoteToken?.symbol, '');
  const baseAddress = safeString(pair?.baseToken?.address, '');
  const quoteAddress = safeString(pair?.quoteToken?.address, '');
  const target = safeString(targetContractAddress, '');

  let score =
    (liq * 1.0) +
    (vol24 * 0.25) +
    (vol1 * 0.8) +
    txScore +
    (mc * 0.08) +
    (fdv * 0.03);

  // Prefer baseToken match when looking up by CA
  if (target && baseAddress.toLowerCase() === target.toLowerCase()) {
    score += 500000;
  }

  // Mild penalty if target token somehow appears as quote token instead
  if (target && quoteAddress.toLowerCase() === target.toLowerCase()) {
    score -= 100000;
  }

  // Prefer SOL / stable quote pairs
  if (isLikelySolQuote(quoteSymbol)) score += 60000;
  if (isLikelyStableQuote(quoteSymbol)) score += 45000;

  // Penalize suspicious / empty pools
  if (liq <= 0) score -= 300000;
  if (vol24 <= 0) score -= 100000;

  return score;
}

function getBestPair(pairs = [], targetContractAddress = null) {
  if (!Array.isArray(pairs) || !pairs.length) return null;

  return [...pairs].sort((a, b) => {
    const scoreA = getPairScore(a, targetContractAddress);
    const scoreB = getPairScore(b, targetContractAddress);
    return scoreB - scoreA;
  })[0];
}

function normalizeCandidatePair(pair) {
  if (!pair) return null;

  const buys5m = toNumber(pair?.txns?.m5?.buys);
  const sells5m = toNumber(pair?.txns?.m5?.sells);
  const buys1h = toNumber(pair?.txns?.h1?.buys);
  const sells1h = toNumber(pair?.txns?.h1?.sells);

  return {
    tokenName: pair?.baseToken?.name || 'Unknown Token',
    ticker: pair?.baseToken?.symbol || 'UNKNOWN',
    poolName: pair?.baseToken?.name || null,
    contractAddress: pair?.baseToken?.address || null,
    pairAddress: pair?.pairAddress || null,
    dexId: pair?.dexId || null,
    pairUrl: pair?.url || null,

    marketCap: toNumber(pair?.marketCap),
    fdv: toNumber(pair?.fdv),
    liquidity: toNumber(pair?.liquidity?.usd),

    volume5m: toNumber(pair?.volume?.m5),
    volume1h: toNumber(pair?.volume?.h1),
    volume24h: toNumber(pair?.volume?.h24),

    buys5m,
    sells5m,
    buys1h,
    sells1h,

    trades5m: buys5m + sells5m,
    trades1h: buys1h + sells1h,

    priceChange5m: toNumber(pair?.priceChange?.m5),
    priceChange1h: toNumber(pair?.priceChange?.h1),
    priceChange24h: toNumber(pair?.priceChange?.h24),

    ageMinutes: getAgeMinutes(pair?.pairCreatedAt),

    website: pair?.info?.websites?.[0]?.url || null,
    twitter: extractSocialLink(pair?.info?.socials || [], 'twitter'),
    telegram: extractSocialLink(pair?.info?.socials || [], 'telegram'),

    dexPaid: !!pair?.boosts?.active || toNumber(pair?.boosts?.amount) > 0
  };
}

/**
 * =========================
 * TOKEN LOOKUP
 * =========================
 */

async function fetchDexScreenerTokenData(contractAddress) {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`;

  const response = await axios.get(url, {
    timeout: 15000,
    headers: {
      Accept: 'application/json'
    }
  });

  const rawPairs = response.data?.pairs || [];

  // Only Solana pairs
  const pairs = rawPairs.filter(
    p => String(p?.chainId || '').toLowerCase() === 'solana'
  );

  if (!pairs.length) {
    return null;
  }

  const bestPair = getBestPair(pairs, contractAddress);

  if (!bestPair) {
    throw new Error('No usable DexScreener pair found.');
  }

  const socials = bestPair?.info?.socials || [];
  const websites = bestPair?.info?.websites || [];

  const buys5m = toNumber(bestPair?.txns?.m5?.buys);
  const sells5m = toNumber(bestPair?.txns?.m5?.sells);
  const buys1h = toNumber(bestPair?.txns?.h1?.buys);
  const sells1h = toNumber(bestPair?.txns?.h1?.sells);
  const buys24h = toNumber(bestPair?.txns?.h24?.buys);
  const sells24h = toNumber(bestPair?.txns?.h24?.sells);

  return {
    raw: {
      pairAddress: bestPair?.pairAddress || null,
      chainId: bestPair?.chainId || null,
      dexId: bestPair?.dexId || null,
      pairUrl: bestPair?.url || null
    },

    token: {
      tokenName: bestPair?.baseToken?.name || 'Unknown Token',
      ticker: bestPair?.baseToken?.symbol || 'UNKNOWN',
      contractAddress: bestPair?.baseToken?.address || contractAddress,
      pairAddress: bestPair?.pairAddress || null,
      website: websites?.[0]?.url || null,
      twitter: extractSocialLink(socials, 'twitter'),
      telegram: extractSocialLink(socials, 'telegram'),
      launchPlatform: bestPair?.dexId || 'Unknown',
      imageUrl: bestPair?.info?.imageUrl || null
    },

    market: {
      marketCap: toNumber(bestPair?.marketCap),
      fdv: toNumber(bestPair?.fdv),
      liquidity: toNumber(bestPair?.liquidity?.usd),

      /** Unix ms when this pair was created (DexScreener). Used for chart migration marker when pool is Raydium-class. */
      pairCreatedAt: (() => {
        const t = Number(bestPair?.pairCreatedAt);
        return Number.isFinite(t) && t > 0 ? t : null;
      })(),

      priceUsd: toNumber(bestPair?.priceUsd),
      priceNative: toNumber(bestPair?.priceNative),

      volume5m: toNumber(bestPair?.volume?.m5),
      volume1h: toNumber(bestPair?.volume?.h1),
      volume6h: toNumber(bestPair?.volume?.h6),
      volume24h: toNumber(bestPair?.volume?.h24),

      ageMinutes: getAgeMinutes(bestPair?.pairCreatedAt),

      priceChange5m: toNumber(bestPair?.priceChange?.m5),
      priceChange1h: toNumber(bestPair?.priceChange?.h1),
      priceChange6h: toNumber(bestPair?.priceChange?.h6),
      priceChange24h: toNumber(bestPair?.priceChange?.h24),

      buys5m,
      sells5m,
      buys1h,
      sells1h,
      buys24h,
      sells24h,

      trades5m: buys5m + sells5m,
      trades1h: buys1h + sells1h,
      trades24h: buys24h + sells24h,

      holders: null
    },

    socials: {
      dexPaid: !!bestPair?.boosts?.active || toNumber(bestPair?.boosts?.amount) > 0,
      websiteLive: !!websites?.[0]?.url
    },

    meta: {
      source: 'dexscreener',
      pairCount: pairs.length,
      migrated: computeMigrated({
        dexId: bestPair?.dexId,
        geckoDexName: null,
        liquidityUsd: toNumber(bestPair?.liquidity?.usd),
        marketCapUsd: toNumber(bestPair?.marketCap),
        ageMinutes: getAgeMinutes(bestPair?.pairCreatedAt),
        volume24h: toNumber(bestPair?.volume?.h24)
      })
    }
  };
}

/**
 * =========================
 * CANDIDATE FEED
 * =========================
 */

async function fetchDexScreenerCandidatePairs() {
  const queries = ['pump', 'sol', 'meme', 'ai'];
  const allPairs = [];

  for (const query of queries) {
    try {
      const url = `https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(query)}`;

      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          Accept: 'application/json'
        }
      });

      const pairs = response.data?.pairs || [];

      for (const pair of pairs) {
        if (String(pair?.chainId || '').toLowerCase() !== 'solana') continue;
        allPairs.push(pair);
      }
    } catch (err) {
      console.error(`[DexScreener Candidate Feed] Query failed: ${query}`, err.message);
    }
  }

  const unique = new Map();

  for (const pair of allPairs) {
    const ca = pair?.baseToken?.address;
    if (!ca) continue;

    const existing = unique.get(ca);

    if (!existing) {
      unique.set(ca, pair);
      continue;
    }

    const better = getBestPair([existing, pair], ca);
    unique.set(ca, better);
  }

  const candidates = [...unique.values()]
    .map(normalizeCandidatePair)
    .filter(Boolean)
    .filter(pair => pair.contractAddress)
    .filter(pair => pair.marketCap > 0)
    .filter(pair => pair.liquidity > 0)
    .sort((a, b) => {
      const scoreA =
        a.liquidity +
        (a.volume1h * 0.5) +
        (a.trades5m * 100) +
        (a.priceChange5m * 100);

      const scoreB =
        b.liquidity +
        (b.volume1h * 0.5) +
        (b.trades5m * 100) +
        (b.priceChange5m * 100);

      return scoreB - scoreA;
    });

  return candidates.slice(0, 75);
}

module.exports = {
  fetchDexScreenerTokenData,
  fetchDexScreenerCandidatePairs
};