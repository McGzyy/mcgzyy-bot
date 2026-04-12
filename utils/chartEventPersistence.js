'use strict';

const axios = require('axios');
const { fetchOhlcv } = require('./ohlcvFetcher');
const { getTrackedCall, updateTrackedCallData } = require('./trackedCallsService');

const ORDERS_TIMEOUT_MS = 15_000;
const BIRDEYE_TIMEOUT_MS = 15_000;
const MAX_EVENTS_PER_KIND = 48;
const OHLCV_LOOKBACK_LIMIT = 1000;

/**
 * @param {unknown} raw
 * @returns {string | null}
 */
function extractBirdeyeCreatorWallet(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ext = /** @type {{ extensions?: unknown }} */ (raw).extensions;
  const candidates = [
    /** @type {{ creator?: unknown }} */ (raw).creator,
    ext && typeof ext === 'object'
      ? /** @type {{ creator?: unknown }} */ (ext).creator
      : null,
    ext && typeof ext === 'object'
      ? /** @type {{ creator_address?: unknown }} */ (ext).creator_address
      : null
  ];
  for (const c of candidates) {
    const s = typeof c === 'string' ? c.trim() : '';
    if (s.length >= 32 && s.length <= 48) return s;
  }
  return null;
}

/**
 * DexScreener orders/boosts API — real payment timestamps only (no synthetic events).
 * @param {string} chainId
 * @param {string} tokenAddress
 * @returns {Promise<number[]>} unique payment times (unix ms)
 */
async function fetchDexScreenerPaymentTimestampsMs(chainId, tokenAddress) {
  const chain = String(chainId || 'solana').toLowerCase();
  const token = String(tokenAddress || '').trim();
  if (!token) return [];

  try {
    const url = `https://api.dexscreener.com/orders/v1/${encodeURIComponent(chain)}/${encodeURIComponent(token)}`;
    const res = await axios.get(url, {
      timeout: ORDERS_TIMEOUT_MS,
      validateStatus: () => true,
      headers: { Accept: 'application/json' }
    });
    if (res.status < 200 || res.status >= 300 || !res.data || typeof res.data !== 'object') {
      return [];
    }

    /** @type {Set<number>} */
    const seen = new Set();
    const add = (ts) => {
      const n = Math.round(Number(ts));
      if (Number.isFinite(n) && n > 0) seen.add(n);
    };

    const orders = Array.isArray(res.data.orders) ? res.data.orders : [];
    for (const o of orders) {
      if (!o || typeof o !== 'object') continue;
      const st = String(/** @type {{ status?: string }} */ (o).status || '').toLowerCase();
      if (st !== 'approved') continue;
      add(/** @type {{ paymentTimestamp?: unknown }} */ (o).paymentTimestamp);
    }

    const boosts = Array.isArray(res.data.boosts) ? res.data.boosts : [];
    for (const b of boosts) {
      if (!b || typeof b !== 'object') continue;
      add(/** @type {{ paymentTimestamp?: unknown }} */ (b).paymentTimestamp);
    }

    return [...seen];
  } catch (_err) {
    return [];
  }
}

/**
 * Token USD from a Birdeye swap row for the tracked mint (observed trade price).
 * @param {string} tokenMint
 * @param {Record<string, unknown>} item
 * @returns {number | null}
 */
function birdeyeTokenUsdFromTxItem(tokenMint, item) {
  const ca = String(tokenMint || '').toLowerCase();
  if (!ca) return null;
  const from = /** @type {{ address?: string, price?: unknown } | null} */ (
    item && typeof item === 'object' ? item.from : null
  );
  const to = /** @type {{ address?: string, price?: unknown } | null} */ (
    item && typeof item === 'object' ? item.to : null
  );
  if (from && String(from.address || '').toLowerCase() === ca) {
    const p = Number(from.price);
    return Number.isFinite(p) && p > 0 ? p : null;
  }
  if (to && String(to.address || '').toLowerCase() === ca) {
    const p = Number(to.price);
    return Number.isFinite(p) && p > 0 ? p : null;
  }
  return null;
}

/**
 * @param {Array<{ time?: unknown, close?: unknown, open?: unknown }>} bars
 * @param {number} targetMs
 * @returns {number | null}
 */
function ohlcvCloseAtOrBefore(bars, targetMs) {
  if (!Array.isArray(bars) || bars.length === 0) return null;
  let bestT = -Infinity;
  let bestClose = null;
  for (const b of bars) {
    const t = Number(b?.time);
    const c = Number(b?.close);
    if (!Number.isFinite(t) || !Number.isFinite(c) || c <= 0) continue;
    if (t <= targetMs && t >= bestT) {
      bestT = t;
      bestClose = c;
    }
  }
  return bestClose;
}

/**
 * @param {Array<{ time: number, price: number }>} existing
 * @param {Array<{ time: number, price: number }>} additions
 * @returns {Array<{ time: number, price: number }>}
 */
function mergeChartEvents(existing, additions) {
  const map = new Map();
  for (const e of existing || []) {
    if (!e || typeof e !== 'object') continue;
    const time = Math.round(Number(e.time));
    const price = Number(e.price);
    if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(price) || price <= 0) continue;
    map.set(time, price);
  }
  for (const e of additions || []) {
    if (!e || typeof e !== 'object') continue;
    const time = Math.round(Number(e.time));
    const price = Number(e.price);
    if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(price) || price <= 0) continue;
    if (!map.has(time)) map.set(time, price);
  }
  const out = [...map.entries()]
    .map(([time, price]) => ({ time, price }))
    .sort((a, b) => a.time - b.time);
  return out.slice(-MAX_EVENTS_PER_KIND);
}

/**
 * Persist DEX paid markers (DexScreener payment timestamps + Gecko OHLCV close) and
 * dev-sell markers (Birdeye token txs when API key + creator wallet are available).
 * Only stores `{ time, price }` from observed APIs — skips rows without a resolvable price.
 *
 * @param {string} contractAddress
 * @param {{ pairAddress?: string|null, contractAddress?: string }} scan
 * @returns {Promise<void>}
 */
async function persistChartMarkerEvents(contractAddress, scan) {
  const ca = String(contractAddress || '').trim();
  if (!ca) return;

  const tracked = getTrackedCall(ca);
  if (!tracked) return;

  const pairAddress = String(
    scan?.pairAddress || tracked.pairAddress || ''
  ).trim();
  if (!pairAddress) return;

  const existingDex = Array.isArray(tracked.dexPaidEvents)
    ? tracked.dexPaidEvents
    : [];
  const existingDev = Array.isArray(tracked.devSoldEvents)
    ? tracked.devSoldEvents
    : [];

  const knownDexTimes = new Set(
    existingDex.map(e => Math.round(Number(e?.time))).filter(Number.isFinite)
  );
  const knownDevKeys = new Set(
    existingDev.map(e => `${Math.round(Number(e?.time))}:${Number(e?.price)}`)
  );

  /** @type {Array<{ time: number, price: number }>} */
  const newDex = [];

  const paymentTimes = await fetchDexScreenerPaymentTimestampsMs('solana', ca);
  const missingDexTimes = paymentTimes.filter(t => !knownDexTimes.has(t));

  if (missingDexTimes.length > 0) {
    const bars = await fetchOhlcv({
      chain: 'solana',
      pairAddress,
      interval: '1m',
      limit: OHLCV_LOOKBACK_LIMIT
    });
    const barList = Array.isArray(bars) ? bars : [];
    for (const t of missingDexTimes) {
      const close = ohlcvCloseAtOrBefore(barList, t);
      if (close != null) {
        newDex.push({ time: t, price: close });
      }
    }
  }

  /** @type {Record<string, unknown>} */
  const updates = {};

  if (newDex.length > 0) {
    updates.dexPaidEvents = mergeChartEvents(existingDex, newDex);
  }

  const apiKey = process.env.BIRDEYE_API_KEY;
  let devWallet =
    typeof tracked.devWalletAddress === 'string'
      ? tracked.devWalletAddress.trim()
      : '';

  if (apiKey) {
    if (!devWallet) {
      try {
        const metaRes = await axios.get(
          'https://public-api.birdeye.so/defi/v3/token/meta-data',
          {
            params: { address: ca },
            headers: { 'X-API-KEY': apiKey, 'x-chain': 'solana' },
            timeout: BIRDEYE_TIMEOUT_MS,
            validateStatus: () => true
          }
        );
        const dataRoot = metaRes.data?.data;
        const creator = extractBirdeyeCreatorWallet(dataRoot);
        if (creator) {
          devWallet = creator;
          updates.devWalletAddress = creator;
        }
      } catch (_err) {
        /* skip dev path */
      }
    }

    if (devWallet) {
      /** @type {Array<{ time: number, price: number }>} */
      const newDev = [];
      try {
        const txRes = await axios.get(
          'https://public-api.birdeye.so/defi/v3/token/txs',
          {
            params: {
              address: ca,
              tx_type: 'sell',
              owner: devWallet,
              limit: 100,
              sort_by: 'block_unix_time',
              sort_type: 'desc'
            },
            headers: { 'X-API-KEY': apiKey, 'x-chain': 'solana' },
            timeout: BIRDEYE_TIMEOUT_MS,
            validateStatus: () => true
          }
        );
        const items = txRes.data?.data?.items;
        if (Array.isArray(items)) {
          for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            if (String(/** @type {{ tx_type?: string }} */ (item).tx_type).toLowerCase() !== 'sell') {
              continue;
            }
            const bt = Number(/** @type {{ block_unix_time?: unknown }} */ (item).block_unix_time);
            if (!Number.isFinite(bt) || bt <= 0) continue;
            const timeMs = Math.round(bt < 1e12 ? bt * 1000 : bt);
            const price = birdeyeTokenUsdFromTxItem(ca, item);
            if (price == null) continue;
            const key = `${timeMs}:${price}`;
            if (knownDevKeys.has(key)) continue;
            newDev.push({ time: timeMs, price });
            knownDevKeys.add(key);
          }
        }
      } catch (_err) {
        /* skip */
      }

      if (newDev.length > 0) {
        updates.devSoldEvents = mergeChartEvents(existingDev, newDev);
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    updateTrackedCallData(ca, updates);
  }
}

module.exports = { persistChartMarkerEvents };
