'use strict';

const {
  fetchOhlcv,
  OHLCV_MAX_LIMIT,
  ohlcvCandleDurationMs
} = require('./ohlcvFetcher');
const { renderCandlestickChart } = require('./candlestickChart');
const { generateRealScan } = require('./scannerEngine');
const { getCandlestickOverlayProps } = require('./candlestickOverlayFromTracked');

/** Default OHLCV range for chart buffers (matches previous hard-coded behavior). */
const DEFAULT_OHLCV_INTERVAL = '5m';
const DEFAULT_OHLCV_LIMIT = 96;

/** Wall-clock span for preset chart windows (limit derived vs candle duration). */
const RANGE_DURATION_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000
};

/**
 * @param {unknown} interval
 * @returns {string}
 */
function normalizeOhlcvInterval(interval) {
  if (interval == null || interval === '') return DEFAULT_OHLCV_INTERVAL;
  return String(interval)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * @param {unknown} limit
 * @returns {number}
 */
function resolveOhlcvLimit(limit) {
  if (typeof limit === 'number' && limit > 0) {
    return Math.floor(limit);
  }
  return DEFAULT_OHLCV_LIMIT;
}

/**
 * @param {unknown} range
 * @returns {'24h'|'7d'|'30d'|'all'|null}
 */
function normalizeOhlcvRange(range) {
  if (range == null || range === '') return null;
  const r = String(range)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  if (r === '24h' || r === '7d' || r === '30d' || r === 'all') {
    return r;
  }
  console.warn(
    '[ohlcvCandlestickBuffer] Unknown OHLCV range %j — using default limit instead',
    range
  );
  return null;
}

/**
 * @param {{
 *   pairAddress: string,
 *   interval: string,
 *   range: string | null,
 *   error: string
 * }} ctx
 */
function logOhlcvBufferIssue(ctx) {
  console.warn(
    '[ohlcvCandlestickBuffer] %s',
    JSON.stringify({
      event: 'ohlcv_chart_pipeline',
      pairAddress: ctx.pairAddress,
      interval: ctx.interval,
      range: ctx.range,
      error: ctx.error
    })
  );
}

/**
 * Candle count for a time preset at the given interval, capped at the provider max.
 * @param {'24h'|'7d'|'30d'|'all'} rangeKey
 * @param {string} interval — normalized interval token (same rules as fetch)
 * @returns {number}
 */
function limitFromOhlcvRange(rangeKey, interval) {
  if (rangeKey === 'all') {
    return OHLCV_MAX_LIMIT;
  }
  const rangeMs = RANGE_DURATION_MS[rangeKey];
  const barMs = ohlcvCandleDurationMs(interval);
  if (!rangeMs || !(barMs > 0)) {
    return DEFAULT_OHLCV_LIMIT;
  }
  const n = Math.ceil(rangeMs / barMs);
  return Math.min(Math.max(1, n), OHLCV_MAX_LIMIT);
}

/**
 * Resolve pool address for Gecko OHLCV (Dex pair), not token CA.
 * @param {{ pairAddress?: string|null } | null} [coin]
 * @param {{ pairAddress?: string|null } | null} [scan]
 * @returns {string}
 */
function resolveOhlcvPairAddress(coin, scan) {
  return String(coin?.pairAddress || scan?.pairAddress || '').trim();
}

/**
 * Fetch OHLCV and render a candlestick PNG. No priceHistory.
 * @param {{
 *   pairAddress?: string|null,
 *   chain?: string,
 *   interval?: string,
 *   limit?: number,
 *   range?: '24h'|'7d'|'30d'|'all'|string,
 *   title?: string|null,
 *   callTimestamp?: number|string|Date,
 *   athPrice?: number,
 *   migratedAt?: number|string|Date,
 *   dexPaidEvents?: Array<{ time: number|string|Date, price: number }>,
 *   devSoldEvents?: Array<{ time: number|string|Date, price: number }>
 *   contractAddress?: string|null — Solana mint; when Dex `pairAddress` has no Gecko OHLCV yet, we try Gecko’s top pool for this mint.
 * }} [options] — `interval` defaults to `5m`, `limit` to 96 when not specified.
 *     Optional `range` (`24h`, `7d`, `30d`, `all`) sets `limit` from the interval (e.g. 288 @ 5m for `24h`), capped at the API max; when `range` is omitted, `limit` behavior is unchanged.
 *     Use `1m` / `5m` / `15m` / `1h` / `4h` / `1d` only; others fall back in `ohlcvFetcher` with a warning.
 * @returns {Promise<Buffer|null>}
 */
async function buildOhlcvCandlestickBuffer(options = {}) {
  const pairAddress = String(options.pairAddress || '').trim();
  if (!pairAddress) return null;

  const mint = String(options.contractAddress || '').trim();
  const chain = options.chain || 'solana';
  const interval = normalizeOhlcvInterval(options.interval);
  const rangeKey = normalizeOhlcvRange(options.range);
  const rangeForLog =
    rangeKey != null
      ? rangeKey
      : options.range != null && String(options.range).trim() !== ''
        ? String(options.range).trim()
        : null;
  const limit = rangeKey
    ? limitFromOhlcvRange(rangeKey, interval)
    : resolveOhlcvLimit(options.limit);
  const title =
    options.title != null && String(options.title).trim() !== ''
      ? String(options.title).trim()
      : 'OHLC';

  /** @type {Record<string, unknown>} */
  const chartOptions = { title };
  if (
    options.callTimestamp !== undefined &&
    options.callTimestamp !== null &&
    options.callTimestamp !== ''
  ) {
    chartOptions.callTimestamp = options.callTimestamp;
  }
  if (
    typeof options.athPrice === 'number' &&
    Number.isFinite(options.athPrice) &&
    options.athPrice > 0
  ) {
    chartOptions.athPrice = options.athPrice;
  }
  if (
    options.migratedAt !== undefined &&
    options.migratedAt !== null &&
    options.migratedAt !== ''
  ) {
    chartOptions.migratedAt = options.migratedAt;
  }
  if (Array.isArray(options.dexPaidEvents) && options.dexPaidEvents.length > 0) {
    chartOptions.dexPaidEvents = options.dexPaidEvents;
  }
  if (Array.isArray(options.devSoldEvents) && options.devSoldEvents.length > 0) {
    chartOptions.devSoldEvents = options.devSoldEvents;
  }

  try {
    const fetchBars = async (pair, iv, lim) =>
      fetchOhlcv({ chain, pairAddress: pair, interval: iv, limit: lim });

    let activePair = pairAddress;
    let bars = await fetchBars(activePair, interval, limit);

    const tryOneMinute = async (pair) => {
      if (interval !== DEFAULT_OHLCV_INTERVAL || rangeKey) return;
      const altLimit = Math.min(200, OHLCV_MAX_LIMIT);
      const retry = await fetchBars(pair, '1m', altLimit);
      if (Array.isArray(retry) && retry.length >= 2) return retry;
      return null;
    };

    if (!Array.isArray(bars) || bars.length < 2) {
      const r1 = await tryOneMinute(activePair);
      if (r1) bars = r1;
    }

    if (
      (!Array.isArray(bars) || bars.length < 2) &&
      mint &&
      chain === 'solana' &&
      !rangeKey
    ) {
      const { fetchGeckoTopPoolAddressForSolanaToken } = require('../providers/geckoTerminalProvider');
      const altPool = await fetchGeckoTopPoolAddressForSolanaToken(mint);
      if (altPool && altPool !== activePair) {
        activePair = altPool;
        bars = await fetchBars(activePair, interval, limit);
        if (!Array.isArray(bars) || bars.length < 2) {
          const r2 = await tryOneMinute(activePair);
          if (r2) bars = r2;
        }
      }
    }

    if (!Array.isArray(bars) || bars.length < 2) {
      logOhlcvBufferIssue({
        pairAddress: `${pairAddress}${activePair !== pairAddress ? ` (tried ${activePair})` : ''}`,
        interval,
        range: rangeForLog,
        error: !Array.isArray(bars)
          ? 'fetch returned non-array'
          : `insufficient bars (${bars.length}); need at least 2`
      });
      return null;
    }

    const buf = await renderCandlestickChart(bars, chartOptions);
    if (buf == null || !Buffer.isBuffer(buf) || buf.length < 100) {
      logOhlcvBufferIssue({
        pairAddress,
        interval,
        range: rangeForLog,
        error:
          buf == null
            ? 'chart render returned null'
            : !Buffer.isBuffer(buf)
              ? 'chart render returned non-buffer'
              : `chart buffer too small (${buf.length} bytes)`
      });
      return null;
    }
    return buf;
  } catch (err) {
    logOhlcvBufferIssue({
      pairAddress,
      interval,
      range: rangeForLog,
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}

/**
 * Pair from tracked call and/or latest monitor scan; optional fresh Dex lookup by CA.
 * @param {{ pairAddress?: string|null, contractAddress?: string|null, ticker?: string|null, tokenName?: string|null }} trackedCall
 * @param {{ pairAddress?: string|null } | null} [latestScan]
 * @param {{ interval?: string, range?: string }} [chartFetchOptions] Optional `interval` / `range` for `fetchOhlcv` (defaults to `5m` / prior limit when omitted).
 * @returns {Promise<Buffer|null>}
 */
async function buildOhlcvCandlestickBufferForTrackedCall(
  trackedCall,
  latestScan = null,
  chartFetchOptions = {}
) {
  if (!trackedCall) return null;

  let pair = resolveOhlcvPairAddress(trackedCall, latestScan);
  let scanForOverlay =
    latestScan && typeof latestScan === 'object' ? latestScan : null;

  const spotMissing =
    !scanForOverlay ||
    !Number.isFinite(Number(scanForOverlay.priceUsd)) ||
    Number(scanForOverlay.priceUsd) <= 0;

  if (trackedCall.contractAddress) {
    if (!pair) {
      try {
        const s = await generateRealScan(trackedCall.contractAddress);
        if (s && !s.__monitorProviderSkip) {
          pair = resolveOhlcvPairAddress(null, s);
          scanForOverlay = s;
        }
      } catch (_err) {
        pair = '';
      }
    } else if (spotMissing) {
      try {
        const s = await generateRealScan(trackedCall.contractAddress);
        if (
          s &&
          !s.__monitorProviderSkip &&
          Number.isFinite(Number(s.priceUsd)) &&
          Number(s.priceUsd) > 0
        ) {
          if (scanForOverlay && typeof scanForOverlay === 'object') {
            scanForOverlay = {
              ...scanForOverlay,
              priceUsd: s.priceUsd,
              marketCap: scanForOverlay.marketCap ?? s.marketCap,
              pairCreatedAt: scanForOverlay.pairCreatedAt ?? s.pairCreatedAt,
              migrated: scanForOverlay.migrated ?? s.migrated,
              dexPaid: scanForOverlay.dexPaid ?? s.dexPaid,
              pairAddress: scanForOverlay.pairAddress || s.pairAddress
            };
          } else {
            scanForOverlay = s;
          }
        }
      } catch (_err) {
        /* keep scanForOverlay */
      }
    }
  }

  const overlay = getCandlestickOverlayProps(
    trackedCall,
    scanForOverlay || latestScan
  );

  /** @type {{ interval?: string, range?: string }} */
  const fetchOverrides = {};
  if (
    chartFetchOptions &&
    typeof chartFetchOptions === 'object' &&
    chartFetchOptions.interval != null &&
    chartFetchOptions.interval !== ''
  ) {
    fetchOverrides.interval = chartFetchOptions.interval;
  }
  if (
    chartFetchOptions &&
    typeof chartFetchOptions === 'object' &&
    chartFetchOptions.range != null &&
    chartFetchOptions.range !== ''
  ) {
    fetchOverrides.range = chartFetchOptions.range;
  }

  return buildOhlcvCandlestickBuffer({
    pairAddress: pair,
    contractAddress: trackedCall.contractAddress || null,
    title: trackedCall.ticker || trackedCall.tokenName || 'OHLC',
    ...overlay,
    ...fetchOverrides
  });
}

module.exports = {
  buildOhlcvCandlestickBuffer,
  buildOhlcvCandlestickBufferForTrackedCall,
  resolveOhlcvPairAddress
};
