'use strict';

/**
 * Heuristics for `scan.migrated` / `requireMigrated` sanity (Solana).
 * DexScreener used to set migrated only when dexId contained "raydium", which
 * rejected many real AMM pools (Meteora, Orca, PumpSwap graduates, etc.).
 */

const MIGRATED_DEX_SUBSTRINGS = [
  'raydium',
  'meteora',
  'orca',
  'lifinity',
  'phoenix',
  'openbook',
  'fluxbeam',
  'pumpswap',
  'dlmm',
  'humidifi',
  'cropper',
  'saros',
  'stabble',
  'crema',
  'mercurial',
  'saber',
  'goosefx',
  'invariant',
  'sanctum',
  'jupiter',
  'cetus',
  'cpmm',
  'fusion',
  'ambient',
  'moonshot',
  'virtual',
  'dexlab',
  'aldrin',
  'stepn',
  'zerofi'
];

function labelHintsMigrated(label) {
  const s = String(label || '')
    .toLowerCase()
    .trim();
  if (!s || s === 'unknown') return false;
  return MIGRATED_DEX_SUBSTRINGS.some(k => s.includes(k));
}

function isPumpBondingDexLabel(label) {
  const s = String(label || '')
    .toLowerCase()
    .trim();
  return s === 'pumpfun' || s === 'pump';
}

/**
 * @param {{
 *   dexId?: string|null,
 *   geckoDexName?: string|null,
 *   liquidityUsd?: number,
 *   marketCapUsd?: number,
 *   ageMinutes?: number|null,
 *   volume24h?: number
 * }} p
 * @returns {boolean}
 */
function computeMigrated(p) {
  if (labelHintsMigrated(p.dexId) || labelHintsMigrated(p.geckoDexName)) {
    return true;
  }

  const liq = Number(p.liquidityUsd);
  const mc = Number(p.marketCapUsd);
  const age = Number(p.ageMinutes);
  const v24 = Number(p.volume24h);

  // Still labeled pump.fun bonding but pool is deep (listing / routing quirks after graduation).
  if (isPumpBondingDexLabel(p.dexId)) {
    if (
      Number.isFinite(liq) &&
      liq >= 50_000 &&
      Number.isFinite(mc) &&
      mc >= 40_000 &&
      Number.isFinite(age) &&
      age >= 25 &&
      Number.isFinite(v24) &&
      v24 >= 100_000
    ) {
      return true;
    }
    return false;
  }

  const dex = String(p.dexId || '').trim();
  if (
    dex &&
    !isPumpBondingDexLabel(p.dexId) &&
    Number.isFinite(liq) &&
    liq >= 75_000 &&
    Number.isFinite(mc) &&
    mc >= 60_000 &&
    Number.isFinite(age) &&
    age >= 60 &&
    Number.isFinite(v24) &&
    v24 >= 200_000
  ) {
    return true;
  }

  return false;
}

module.exports = {
  computeMigrated,
  labelHintsMigrated,
  isPumpBondingDexLabel
};
