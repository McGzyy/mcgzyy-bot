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

const SEARCH_TERMS = ['sol', 'ai', 'meme', 'bonk'];

/** 0 .. SEARCH_TERMS.length - 1 only — never out of range */
let searchTermIndex = 0;
let currentPage = 1;
const MAX_PAGE = 5;

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

/**
 * @param {unknown[]} included
 * @returns {Map<string, string>}
 */
function buildTokenImageMapFromIncluded(included) {
  const map = new Map();
  if (!Array.isArray(included)) return map;
  for (const item of included) {
    if (!item || item.type !== 'token' || !item.id) continue;
    const img = item.attributes?.image_url;
    if (typeof img === 'string' && img.trim()) map.set(item.id, img.trim());
  }
  return map;
}

/**
 * @param {unknown} pool
 * @param {Map<string, string>} [tokenImageById]
 */
function normalizePool(pool, tokenImageById) {
  if (!pool) return null;

  const attributes = pool.attributes || {};
  const relationships = pool.relationships || {};

  const baseTokenAddress =
    relationships?.base_token?.data?.id?.split('_')?.pop() || null;

  const quoteTokenAddress =
    relationships?.quote_token?.data?.id?.split('_')?.pop() || null;

  const baseTokenRelId = relationships?.base_token?.data?.id || null;
  const map = tokenImageById instanceof Map ? tokenImageById : new Map();
  const geckoImageUrl =
    baseTokenRelId && map.has(baseTokenRelId) ? map.get(baseTokenRelId) : null;

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
    ageMinutes: getAgeMinutes(attributes?.pool_created_at),

    ...(geckoImageUrl ? { geckoImageUrl } : {})
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
    const url = `${GECKO_BASE}/networks/solana/new_pools?page=${page}&include=base_token`;
    console.log(`[GeckoTerminal] Fetching NEW pools page ${page}`);

    const response = await axios.get(url, {
      headers: { Accept: 'application/json' },
      timeout: 15000
    });

    let pools = response.data?.data || [];
    if (!Array.isArray(pools)) pools = [];
    let included = response.data?.included || [];
    if (!Array.isArray(included)) included = [];

    return { pools, included };
  } catch (error) {
    console.log(`[GeckoTerminal] NEW pools fetch failed: ${error.message}`);
    return { pools: [], included: [] };
  }
}

async function fetchSearchPoolsPage(term, page) {
  const safeTerm =
    term != null && String(term).trim() !== ''
      ? String(term).trim()
      : SEARCH_TERMS[0];

  try {
    const url = `${GECKO_BASE}/search/pools?query=${encodeURIComponent(
      safeTerm
    )}&page=${page}&include=base_token`;
    console.log(`[GeckoTerminal] Fetching SEARCH "${safeTerm}" page ${page}`);

    const response = await axios.get(url, {
      headers: { Accept: 'application/json' },
      timeout: 15000
    });

    let pools = response.data?.data || [];
    if (!Array.isArray(pools)) pools = [];
    let included = response.data?.included || [];
    if (!Array.isArray(included)) included = [];

    const filtered = pools.filter(isSolanaNetworkPool);
    return { pools: filtered, included };
  } catch (error) {
    console.log(`[GeckoTerminal] SEARCH fetch failed: ${error.message}`);
    return { pools: [], included: [] };
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

    const [newRes, searchRes] = await Promise.all([
      fetchNewPoolsPage(currentPage),
      fetchSearchPoolsPage(term, currentPage)
    ]);

    const combined = dedupeRawPoolsById([
      ...(newRes.pools || []),
      ...(searchRes.pools || [])
    ]);

    const includedMerged = [
      ...(newRes.included || []),
      ...(searchRes.included || [])
    ];
    const tokenImageById = buildTokenImageMapFromIncluded(includedMerged);

    advanceRotationAfterCycle();

    const normalized = combined.map(p => normalizePool(p, tokenImageById)).filter(Boolean);

    const filtered = normalized.filter(pool => {
      if (!pool.contractAddress) return false;
      if (pool.liquidity < 10000) return false;
      if (pool.volume5m < 10000) return false;
      if (pool.txns5m < 4 && pool.txns1h < 20) return false;

      const ratio = pool.sells5m > 0 ? pool.buys5m / pool.sells5m : 99;
      if (ratio > 8) return false;

      if (pool.ageMinutes && pool.ageMinutes > 720) return false;

      return true;
    });

    console.log(`[GeckoTerminal] Returned ${filtered.length} candidates`);

    return filtered.slice(0, 48);
  } catch (error) {
    console.error('[GeckoTerminal] Candidate fetch failed:', error.message);
    return [];
  }
}

/**
 * GeckoTerminal token metadata `image_url` for Solana mint (non-throwing).
 * @param {string} contractAddress
 * @returns {Promise<string | null>}
 */
async function fetchGeckoSolanaTokenImageUrl(contractAddress) {
  const ca =
    contractAddress != null && String(contractAddress).trim()
      ? String(contractAddress).trim()
      : '';
  if (!ca) return null;
  try {
    const url = `${GECKO_BASE}/networks/solana/tokens/${encodeURIComponent(ca)}`;
    const response = await axios.get(url, {
      headers: { Accept: 'application/json' },
      timeout: 8000
    });
    const img = response.data?.data?.attributes?.image_url;
    if (typeof img === 'string' && img.trim()) return img.trim();
  } catch (_) {
    /* ignore */
  }
  return null;
}

module.exports = {
  fetchGeckoTerminalCandidatePools,
  fetchGeckoSolanaTokenImageUrl
};
