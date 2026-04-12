'use strict';

/**
 * Derive candlestick overlay props from tracked call + latest scan (same price axis as Gecko OHLCV = token USD).
 * Only returns keys that are valid — never null placeholders.
 *
 * **Event marker data sources (today):**
 * - **migratedAt** — DexScreener `pairCreatedAt` (unix ms) on the live best pair when `scan.migrated` is true
 *   (Raydium-class `dexId`, same heuristic as `meta.migrated`). Optional `trackedCall.migratedAt` if the scan
 *   did not supply a pool creation time.
 * - **dexPaidEvents** / **devSoldEvents** — persisted on the tracked call by `chartEventPersistence.persistChartMarkerEvents`
 *   (monitor loop): DEX paid times from DexScreener `/orders/v1/...` (approved orders + boost payments) with token
 *   USD from Gecko 1m OHLCV close at/ before that time; dev sells from Birdeye `/defi/v3/token/txs` (sell, owner=creator)
 *   with USD price from the trade row when `BIRDEYE_API_KEY` is set. Optional `latestScan` can still override if populated.
 */

/**
 * @param {unknown} raw
 * @returns {number | null}
 */
function parseSingleTimeMs(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw);
  }
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {unknown} raw
 * @returns {Array<{ time: number, price: number }>}
 */
function normalizeOverlayPriceEvents(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const tRaw =
      /** @type {{ time?: unknown, t?: unknown, ts?: unknown, timestamp?: unknown }} */ (row)
        .time ??
      /** @type {{ t?: unknown }} */ (row).t ??
      /** @type {{ ts?: unknown }} */ (row).ts ??
      /** @type {{ timestamp?: unknown }} */ (row).timestamp;
    const timeMs = parseSingleTimeMs(tRaw);
    const price = Number(
      /** @type {{ price?: unknown, p?: unknown }} */ (row).price ??
        /** @type {{ p?: unknown }} */ (row).p
    );
    if (timeMs == null || !Number.isFinite(price)) continue;
    out.push({ time: timeMs, price });
  }
  return out;
}

/**
 * @param {unknown} tracked
 * @param {unknown} scan
 * @param {'dexPaidEvents' | 'devSoldEvents'} key
 * @returns {Array<{ time: number, price: number }>}
 */
function pickOverlayPriceEvents(tracked, scan, key) {
  const fromTracked = normalizeOverlayPriceEvents(
    tracked && typeof tracked === 'object'
      ? /** @type {{ dexPaidEvents?: unknown, devSoldEvents?: unknown }} */ (tracked)[
          key
        ]
      : null
  );
  if (fromTracked.length > 0) return fromTracked;
  return normalizeOverlayPriceEvents(
    scan && typeof scan === 'object'
      ? /** @type {{ dexPaidEvents?: unknown, devSoldEvents?: unknown }} */ (scan)[key]
      : null
  );
}

function parseTrackedCallTimeMs(trackedCall) {
  if (!trackedCall) return null;
  const raw =
    trackedCall.firstCalledAt ||
    trackedCall.calledAt ||
    trackedCall.createdAt ||
    null;
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw);
  }
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Implied token USD price at ATH MC, assuming ~constant supply: P_ath / P_now ≈ MC_ath / MC_now.
 * @param {{ athMc?: number, ath?: number, athMarketCap?: number, latestMarketCap?: number } | null} trackedCall
 * @param {{ marketCap?: number, priceUsd?: number } | null} latestScan
 * @returns {number|null}
 */
function computeAthTokenPriceUsd(trackedCall, latestScan) {
  if (!trackedCall) return null;
  const athMc = Number(
    trackedCall.athMc ??
      trackedCall.ath ??
      trackedCall.athMarketCap ??
      0
  );
  const latestMc = Number(
    latestScan?.marketCap ?? trackedCall.latestMarketCap ?? 0
  );
  const spotPrice = Number(latestScan?.priceUsd);
  if (!(athMc > 0 && latestMc > 0 && Number.isFinite(spotPrice) && spotPrice > 0)) {
    return null;
  }
  const athPrice = spotPrice * (athMc / latestMc);
  return Number.isFinite(athPrice) && athPrice > 0 ? athPrice : null;
}

/**
 * @param {{ firstCalledAt?: string, calledAt?: string, createdAt?: string, latestMarketCap?: number, athMc?: number, ath?: number, athMarketCap?: number, migratedAt?: number|string|Date, dexPaidEvents?: unknown, devSoldEvents?: unknown } | null} trackedCall
 * @param {{ marketCap?: number, priceUsd?: number, migrated?: boolean, pairCreatedAt?: number, dexPaidEvents?: unknown, devSoldEvents?: unknown } | null} [latestScan]
 * @returns {{ callTimestamp?: number, athPrice?: number, migratedAt?: number, dexPaidEvents?: Array<{ time: number, price: number }>, devSoldEvents?: Array<{ time: number, price: number }> }}
 */
function getCandlestickOverlayProps(trackedCall, latestScan = null) {
  /** @type {{ callTimestamp?: number, athPrice?: number, migratedAt?: number, dexPaidEvents?: Array<{ time: number, price: number }>, devSoldEvents?: Array<{ time: number, price: number }> }} */
  const props = {};
  if (!trackedCall) return props;

  const callMs = parseTrackedCallTimeMs(trackedCall);
  if (callMs != null) {
    props.callTimestamp = callMs;
  }

  const athPrice = computeAthTokenPriceUsd(trackedCall, latestScan);
  if (athPrice != null) {
    props.athPrice = athPrice;
  }

  if (latestScan && typeof latestScan === 'object' && latestScan.migrated === true) {
    const pc = Number(latestScan.pairCreatedAt);
    if (Number.isFinite(pc) && pc > 0) {
      props.migratedAt = pc < 1e12 ? Math.round(pc * 1000) : Math.round(pc);
    }
  }
  if (props.migratedAt == null && trackedCall.migratedAt != null) {
    const ms = parseSingleTimeMs(trackedCall.migratedAt);
    if (ms != null) {
      props.migratedAt = ms;
    }
  }

  const dexPaid = pickOverlayPriceEvents(trackedCall, latestScan, 'dexPaidEvents');
  if (dexPaid.length > 0) {
    props.dexPaidEvents = dexPaid;
  }

  const devSold = pickOverlayPriceEvents(trackedCall, latestScan, 'devSoldEvents');
  if (devSold.length > 0) {
    props.devSoldEvents = devSold;
  }

  return props;
}

module.exports = {
  getCandlestickOverlayProps,
  parseTrackedCallTimeMs,
  computeAthTokenPriceUsd
};
