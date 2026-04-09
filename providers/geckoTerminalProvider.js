const axios = require('axios');

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';

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

/** 0 .. SEARCH_TERMS.length - 1 only — never out of range */
let searchTermIndex = 0;
let currentPage = 1;
const MAX_PAGE = 4;

/**
 * =========================
 * NETWORK FILTER (search — multi-chain results)
 * =========================
 */

function isSolanaNetworkPool(pool) {
  if (!pool) return false;

  const networkId = pool.relationships?.network?.data?.id;
  if (networkId != null && String(networkId).trim() !== '') {
    return String(networkId).toLowerCase() === 'solana';
  }

  const poolId = String(pool.id || '');
  const u = poolId.indexOf('_');
  if (u > 0) {
    return poolId.slice(0, u).toLowerCase() === 'solana';
  }

  return poolId.toLowerCase().includes('solana');
}

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

function dedupeRawPoolsById(pools) {
  const seen = new Set();
  const out = [];

  for (const pool of pools) {
    const id = pool?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(pool);
  }

  return out;
}

async function fetchNewPoolsPage(page) {
  try {
    const url = `${GECKO_BASE}/networks/solana/new_pools?page=${page}`;
    console.log(`[GeckoTerminal] Fetching NEW pools page ${page}`);

    const response = await axios.get(url, {
      headers: { Accept: 'application/json' },
      timeout: 15000
    });

    let pools = response.data?.data || [];
    if (!Array.isArray(pools)) pools = [];

    return pools;
  } catch (error) {
    console.log(`[GeckoTerminal] NEW pools fetch failed: ${error.message}`);
    return [];
  }
}

async function fetchSearchPoolsPage(term, page) {
  const safeTerm =
    term != null && String(term).trim() !== ''
      ? String(term).trim()
      : SEARCH_TERMS[0];

  try {
    const url = `${GECKO_BASE}/search/pools?query=${encodeURIComponent(safeTerm)}&page=${page}`;
    console.log(`[GeckoTerminal] Fetching SEARCH "${safeTerm}" page ${page}`);

    const response = await axios.get(url, {
      headers: { Accept: 'application/json' },
      timeout: 15000
    });

    let pools = response.data?.data || [];
    if (!Array.isArray(pools)) pools = [];

    return pools.filter(isSolanaNetworkPool);
  } catch (error) {
    console.log(`[GeckoTerminal] SEARCH fetch failed: ${error.message}`);
    return [];
  }
}

/**
 * After each full cycle (NEW + SEARCH): rotate term; bump page when term wraps.
 */
function advanceRotationAfterCycle() {
  searchTermIndex = (searchTermIndex + 1) % SEARCH_TERMS.length;

  if (searchTermIndex === 0) {
    currentPage += 1;
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
    const term = SEARCH_TERMS[searchTermIndex];

    const [newRaw, searchRaw] = await Promise.all([
      fetchNewPoolsPage(currentPage),
      fetchSearchPoolsPage(term, currentPage)
    ]);

    const combined = dedupeRawPoolsById([...newRaw, ...searchRaw]);

    advanceRotationAfterCycle();

    const normalized = combined.map(normalizePool).filter(Boolean);

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
