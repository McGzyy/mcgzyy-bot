const axios = require('axios');

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function getAgeMinutes(createdAt) {
  if (!createdAt) return null;

  const ts = new Date(createdAt).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return null;

  return Math.floor((Date.now() - ts) / (1000 * 60));
}

/**
 * =========================
 * ROTATION STATE
 * =========================
 */

const SEARCH_TERMS = ['sol', 'ai', 'meme'];

let rotationIndex = 0;
let currentPage = 1;
const MAX_PAGE = 4;

/**
 * =========================
 * NORMALIZE
 * =========================
 */

function normalizePool(pool) {
  if (!pool) return null;

  const attributes = pool.attributes || {};
  const relationships = pool.relationships || {};

  const baseTokenAddress =
    relationships?.base_token?.data?.id?.split('_')?.pop() || null;

  const quoteTokenAddress =
    relationships?.quote_token?.data?.id?.split('_')?.pop() || null;

  const poolAddress =
    attributes?.address ||
    pool.id ||
    null;

  const buys5m = safeNumber(attributes?.transactions?.m5?.buys);
  const sells5m = safeNumber(attributes?.transactions?.m5?.sells);
  const buys1h = safeNumber(attributes?.transactions?.h1?.buys);
  const sells1h = safeNumber(attributes?.transactions?.h1?.sells);

  return {
    source: 'geckoterminal',
    contractAddress: baseTokenAddress,
    pairAddress: poolAddress,
    quoteTokenAddress,

    dexId: attributes?.dex_name || null,
    poolName: attributes?.name || null,

    marketCap: safeNumber(attributes?.market_cap_usd),
    fdv: safeNumber(attributes?.fdv_usd),
    liquidity: safeNumber(attributes?.reserve_in_usd),
    volume5m: safeNumber(attributes?.volume_usd?.m5),
    volume1h: safeNumber(attributes?.volume_usd?.h1),
    volume24h: safeNumber(attributes?.volume_usd?.h24),

    txns5m: buys5m + sells5m,
    txns1h: buys1h + sells1h,
    txns24h:
      safeNumber(attributes?.transactions?.h24?.buys) +
      safeNumber(attributes?.transactions?.h24?.sells),

    buys5m,
    sells5m,
    buys1h,
    sells1h,

    priceChange5m: safeNumber(attributes?.price_change_percentage?.m5),
    priceChange1h: safeNumber(attributes?.price_change_percentage?.h1),
    priceChange24h: safeNumber(attributes?.price_change_percentage?.h24),

    createdAt: attributes?.pool_created_at || null,
    ageMinutes: getAgeMinutes(attributes?.pool_created_at)
  };
}

/**
 * =========================
 * FETCH SINGLE PAGE
 * =========================
 */

async function fetchSinglePage() {
  try {
    let url;

    const isNewPools = rotationIndex === 0;

    if (isNewPools) {
      url = `${GECKO_BASE}/networks/solana/new_pools?page=${currentPage}`;
      console.log(`[GeckoTerminal] Fetching NEW pools page ${currentPage}`);
    } else {
      const term = SEARCH_TERMS[rotationIndex - 1];
      url = `${GECKO_BASE}/search/pools?query=${encodeURIComponent(term)}&page=${currentPage}`;
      console.log(`[GeckoTerminal] Fetching SEARCH "${term}" page ${currentPage}`);
    }

    const response = await axios.get(url, {
      headers: { Accept: 'application/json' },
      timeout: 15000
    });

    let pools = response.data?.data || [];

    if (!Array.isArray(pools)) pools = [];

    if (!isNewPools) {
      pools = pools.filter(pool =>
        String(pool?.id || '').toLowerCase().includes('solana')
      );
    }

    return pools;
  } catch (error) {
    console.log(`[GeckoTerminal] Page fetch failed: ${error.message}`);
    return [];
  }
}

/**
 * =========================
 * ROTATION ADVANCE
 * =========================
 */

function advanceRotation() {
  rotationIndex++;

  if (rotationIndex > SEARCH_TERMS.length) {
    rotationIndex = 0;
    currentPage++;
    if (currentPage > MAX_PAGE) currentPage = 1;
  }
}

/**
 * =========================
 * MAIN
 * =========================
 */

async function fetchGeckoTerminalCandidatePools() {
  try {
    const rawPools = await fetchSinglePage();

    // rotate AFTER fetch
    advanceRotation();

    const normalized = rawPools.map(normalizePool).filter(Boolean);

    const filtered = normalized.filter(pool => {
      if (!pool.contractAddress) return false;
      if (pool.liquidity < 3500) return false;
      if (pool.volume5m < 400 && pool.volume1h < 2500) return false;
      if (pool.txns5m < 4 && pool.txns1h < 20) return false;

      const ratio = pool.sells5m > 0 ? pool.buys5m / pool.sells5m : 99;
      if (ratio > 8) return false;

      if (pool.ageMinutes && pool.ageMinutes > 720) return false;

      return true;
    });

    console.log(`[GeckoTerminal] Returned ${filtered.length} candidates`);

    return filtered.slice(0, 40);
  } catch (error) {
    console.error('[GeckoTerminal] Candidate fetch failed:', error.message);
    return [];
  }
}

module.exports = {
  fetchGeckoTerminalCandidatePools
};