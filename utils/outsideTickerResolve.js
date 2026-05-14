'use strict';

/**
 * Resolve $CASHTAG mentions on X to a Solana mint for outside-call ingest (tiered, conservative).
 *
 * Tier 1: `utils/outsideTickerCanonicalMints.json` (majors / obvious Solana tokens you maintain).
 * Tier 2: Dexscreener latest search API — highest-liquidity Solana pair for the symbol, gated by
 *         OUTSIDE_TICKER_MIN_LIQ_USD (default 25_000). Disable with OUTSIDE_TICKER_DEX_SEARCH_DISABLED=1.
 *
 * Not auto-resolved: ambiguous symbols, thin pairs, or posts with no usable cashtag.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const CASHTAG_RE = /\$([A-Za-z][A-Za-z0-9]{1,14})\b/g;

/** Cashtags that are usually English words / noise on CT, not tickers. */
const CASHTAG_DENY = new Set([
  'AND',
  'OR',
  'THE',
  'NEW',
  'TOP',
  'NOW',
  'ALL',
  'ONE',
  'TWO',
  'BIG',
  'LOW',
  'HIGH',
  'WIN',
  'YES',
  'NOT',
  'FOR',
  'ARE',
  'BUT',
  'YOU',
  'OUR',
  'OUT',
  'DAY',
  'WAY',
  'GET',
  'CAN',
  'HAS',
  'HAD',
  'HIS',
  'HER',
  'ITS',
  'WHO',
  'WHY',
  'HOW',
  'USD',
  'EUR',
  'GBP',
  'NFT',
  'ATH',
  'ATL',
  'DCA',
  'ROI',
  'KYC',
  'CEO',
  'CTO',
  'USA',
  'UK',
  'TV',
  'AI',
  'IT',
  'UP',
  'SO',
  'GO',
  'DO',
  'NO',
  'OK',
  'VS',
  'X',
  'GM',
  'GN',
  'LFG',
  'WAGMI',
  'NGMI',
  'FUD',
  'FOMO',
  'DYOR',
  'NFA',
  'IMO',
  'AMA',
  'IRL',
  'TG',
  'DC',
  'DM',
  'PM',
  'AM',
  'EST',
  'PST',
  'UTC',
  'ETF',
  'IPO',
  'SEC'
]);

function truthyEnv(v) {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function looksLikeSolMint(s) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(s || '').trim());
}

let _curatedCache = null;
let _curatedMtime = 0;

function loadCuratedMap() {
  const fp = path.join(__dirname, 'outsideTickerCanonicalMints.json');
  try {
    const st = fs.statSync(fp);
    if (_curatedCache && st.mtimeMs === _curatedMtime) {
      return _curatedCache;
    }
    const raw = fs.readFileSync(fp, 'utf8');
    const j = JSON.parse(raw);
    const map = new Map();
    if (j && typeof j === 'object') {
      for (const [k, v] of Object.entries(j)) {
        const sym = String(k || '')
          .trim()
          .toUpperCase();
        const mint = String(v || '').trim();
        if (!sym || !looksLikeSolMint(mint)) continue;
        map.set(sym, mint);
      }
    }
    _curatedCache = map;
    _curatedMtime = st.mtimeMs;
    return map;
  } catch (e) {
    console.warn('[OutsideTicker] curated map load failed:', e?.message || e);
    _curatedCache = new Map();
    _curatedMtime = Date.now();
    return _curatedCache;
  }
}

/**
 * @param {string} text
 * @returns {string[]} uppercased symbols in tweet order, de-duped preserving order
 */
function extractCashtagCandidates(text) {
  const t = String(text || '');
  const seen = new Set();
  const out = [];
  let m;
  CASHTAG_RE.lastIndex = 0;
  while ((m = CASHTAG_RE.exec(t)) !== null) {
    const sym = String(m[1] || '')
      .trim()
      .toUpperCase();
    if (!sym || sym.length < 2 || CASHTAG_DENY.has(sym)) continue;
    if (seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out;
}

async function resolveViaDexSearch(symbolUpper) {
  if (truthyEnv(process.env.OUTSIDE_TICKER_DEX_SEARCH_DISABLED)) {
    return '';
  }
  const minLiq = Math.max(
    0,
    Math.min(5_000_000, Number(process.env.OUTSIDE_TICKER_MIN_LIQ_USD || 25_000) || 25_000)
  );
  const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbolUpper)}`;
  try {
    const res = await axios.get(url, { timeout: 12_000, validateStatus: () => true });
    if (res.status !== 200 || !res.data || typeof res.data !== 'object') {
      return '';
    }
    const pairs = Array.isArray(res.data.pairs) ? res.data.pairs : [];
    const sol = pairs
      .filter((p) => p && String(p.chainId || '').toLowerCase() === 'solana')
      .map((p) => ({
        liq: Number(p.liquidity?.usd ?? 0) || 0,
        mint: String(p.baseToken?.address || '').trim()
      }))
      .filter((x) => looksLikeSolMint(x.mint) && x.liq >= minLiq);
    sol.sort((a, b) => b.liq - a.liq);
    const top = sol[0];
    return top && top.mint ? top.mint : '';
  } catch (e) {
    console.warn('[OutsideTicker] dex search failed', symbolUpper, e?.message || e);
    return '';
  }
}

/**
 * @param {string} tweetText
 * @returns {Promise<{ mint: string, resolution: 'curated_map' | 'dex_search', tickerNormalized: string } | null>}
 */
async function resolveTickerToMintSolana(tweetText) {
  const candidates = extractCashtagCandidates(tweetText);
  if (candidates.length === 0) {
    return null;
  }

  const curated = loadCuratedMap();
  for (const sym of candidates) {
    const mint = curated.get(sym);
    if (mint && looksLikeSolMint(mint)) {
      return { mint, resolution: 'curated_map', tickerNormalized: sym };
    }
  }

  for (const sym of candidates) {
    const mint = await resolveViaDexSearch(sym);
    if (mint && looksLikeSolMint(mint)) {
      return { mint, resolution: 'dex_search', tickerNormalized: sym };
    }
  }

  return null;
}

module.exports = {
  extractCashtagCandidates,
  resolveTickerToMintSolana,
  loadCuratedMap
};
