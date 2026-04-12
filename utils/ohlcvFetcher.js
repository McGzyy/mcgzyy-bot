/**
 * Reusable OHLCV fetcher with a swappable provider (default: GeckoTerminal API).
 * Not tied to Discord commands — safe to call from anywhere; failures never throw.
 */

const axios = require('axios');

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_LIMIT = 1000;

/** Only these interval tokens are accepted; anything else falls back to `5m` with a warning. */
const DEFAULT_OHLCV_INTERVAL = '5m';

/**
 * Canonical GeckoTerminal OHLCV intervals (timeframe + aggregate).
 */
const INTERVAL_PRESETS = {
  '1m': { timeframe: 'minute', aggregate: 1 },
  '5m': { timeframe: 'minute', aggregate: 5 },
  '15m': { timeframe: 'minute', aggregate: 15 },
  '1h': { timeframe: 'hour', aggregate: 1 },
  '4h': { timeframe: 'hour', aggregate: 4 },
  '1d': { timeframe: 'day', aggregate: 1 }
};

/** @typedef {{ time: number, open: number, high: number, low: number, close: number, volume: number }} OhlcvBar */
/** @typedef {{ chain?: string, pairAddress: string, interval?: string, limit?: number }} OhlcvFetchParams */

/**
 * Provider contract: given normalized params, return normalized bars or [] on soft failure.
 * @typedef {{ fetch: (params: { network: string, pairAddress: string, timeframe: string, aggregate: number, limit: number }) => Promise<OhlcvBar[]> }} OhlcvProvider
 */

const CHAIN_ALIASES = {
  sol: 'solana',
  solana: 'solana',
  eth: 'eth',
  ethereum: 'eth',
  base: 'base',
  bsc: 'bsc',
  arbitrum: 'arbitrum',
  polygon: 'polygon_pos',
  matic: 'polygon_pos'
};

/** @type {OhlcvProvider | null} */
let customProvider = null;

function toNetworkId(chain) {
  const key = String(chain || 'solana')
    .trim()
    .toLowerCase();
  if (!key) return 'solana';
  return CHAIN_ALIASES[key] || key;
}

/**
 * Map interval string to GeckoTerminal `timeframe` + `aggregate`.
 * Allowed: `1m`, `5m`, `15m`, `1h`, `4h`, `1d` (case/whitespace-insensitive).
 * Missing/empty uses `5m` with no warning; unsupported values log a warning and use `5m`.
 * @param {string} [interval]
 * @returns {{ timeframe: 'minute'|'hour'|'day', aggregate: number }}
 */
function parseInterval(interval) {
  const fallback = { ...INTERVAL_PRESETS[DEFAULT_OHLCV_INTERVAL] };

  if (interval == null || interval === '') {
    return fallback;
  }

  const raw = String(interval)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  if (raw === '') {
    return fallback;
  }

  if (INTERVAL_PRESETS[raw]) {
    return { ...INTERVAL_PRESETS[raw] };
  }

  console.warn(
    '[ohlcvFetcher] Unsupported OHLCV interval %j — falling back to %s',
    interval,
    DEFAULT_OHLCV_INTERVAL
  );
  return fallback;
}

/**
 * Milliseconds spanned by one candle for the given interval token (after `parseInterval` rules).
 * @param {string} [interval]
 * @returns {number}
 */
function ohlcvCandleDurationMs(interval) {
  const { timeframe, aggregate } = parseInterval(interval);
  const agg = Math.max(1, Math.floor(Number(aggregate)) || 1);
  if (timeframe === 'minute') return agg * 60 * 1000;
  if (timeframe === 'hour') return agg * 60 * 60 * 1000;
  return agg * 24 * 60 * 60 * 1000;
}

function toNum(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * GeckoTerminal `ohlcv_list` row: [unixSec, open, high, low, close, volume]
 * @param {unknown[]} row
 * @returns {OhlcvBar | null}
 */
function normalizeGeckoRow(row) {
  if (!Array.isArray(row) || row.length < 6) return null;
  const t = toNum(row[0]);
  if (!Number.isFinite(t) || t <= 0) return null;
  return {
    time: Math.floor(t * 1000),
    open: toNum(row[1]),
    high: toNum(row[2]),
    low: toNum(row[3]),
    close: toNum(row[4]),
    volume: toNum(row[5])
  };
}

/**
 * @param {{ network: string, pairAddress: string, timeframe: string, aggregate: number, limit: number }} p
 * @returns {Promise<OhlcvBar[]>}
 */
async function geckoTerminalFetch(p) {
  const pair = String(p.pairAddress || '').trim();
  if (!pair) return [];

  const limit = Math.min(Math.max(1, p.limit || 100), MAX_LIMIT);
  const url = `${GECKO_BASE}/networks/${encodeURIComponent(p.network)}/pools/${encodeURIComponent(pair)}/ohlcv/${encodeURIComponent(p.timeframe)}`;

  const res = await axios.get(url, {
    params: {
      aggregate: p.aggregate,
      limit
    },
    timeout: DEFAULT_TIMEOUT_MS,
    validateStatus: () => true,
    headers: {
      Accept: 'application/json;version=20230203'
    }
  });

  if (res.status < 200 || res.status >= 300) {
    return [];
  }

  const list = res.data?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) return [];

  const bars = [];
  for (const row of list) {
    const bar = normalizeGeckoRow(row);
    if (bar) bars.push(bar);
  }

  bars.sort((a, b) => a.time - b.time);
  return bars;
}

/** @type {OhlcvProvider} */
const defaultGeckoProvider = {
  fetch: geckoTerminalFetch
};

/**
 * Replace the default GeckoTerminal provider (e.g. DexScreener or paid CoinGecko onchain).
 * Pass `null` to restore the built-in provider.
 * @param {OhlcvProvider | null} provider
 */
function registerOhlcvProvider(provider) {
  customProvider = provider;
}

function activeProvider() {
  return customProvider && typeof customProvider.fetch === 'function'
    ? customProvider
    : defaultGeckoProvider;
}

/**
 * Fetch OHLCV candles for a pool (pair) address.
 *
 * @param {OhlcvFetchParams} params
 * @param {string} [params.interval] `1m`, `5m`, `15m`, `1h`, `4h`, or `1d` (default `5m`; unsupported values fall back with a warning).
 * @param {number} [params.limit] Bar count, 1–1000 (default 100 when omitted here; chart layer may override).
 * @returns {Promise<OhlcvBar[]|null>} `null` if required args are missing; `[]` on network/API failure
 */
async function fetchOhlcv(params = {}) {
  try {
    const pairAddress = String(params.pairAddress || '').trim();
    if (!pairAddress) return null;

    const network = toNetworkId(params.chain);
    const { timeframe, aggregate } = parseInterval(params.interval);
    const limit = Math.min(
      Math.max(1, Number(params.limit) || 100),
      MAX_LIMIT
    );

    const provider = activeProvider();
    const bars = await provider.fetch({
      network,
      pairAddress,
      timeframe,
      aggregate,
      limit
    });

    return Array.isArray(bars) ? bars : [];
  } catch (_err) {
    return [];
  }
}

module.exports = {
  fetchOhlcv,
  registerOhlcvProvider,
  OHLCV_MAX_LIMIT: MAX_LIMIT,
  ohlcvCandleDurationMs
};
