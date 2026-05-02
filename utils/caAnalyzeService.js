'use strict';

const { generateRealScan } = require('./scannerEngine');
const { evaluateAutoCallFiltersOnScan } = require('./autoCallEngine');
const { autoCallConfig } = require('../config/autoCallConfig');

/**
 * @param {string} raw
 * @returns {string|null}
 */
function extractSolanaContractAddress(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;

  const urlMatch = s.match(/dexscreener\.com\/solana\/([1-9A-HJ-NP-Za-km-z]{32,50})/i);
  if (urlMatch) s = urlMatch[1];

  const birdeye = s.match(/birdeye\.so\/token\/([1-9A-HJ-NP-Za-km-z]{32,50})/i);
  if (birdeye) s = birdeye[1];

  s = s.split(/[\s,#?]/)[0].trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(s)) return null;
  return s;
}

/**
 * @param {Record<string, unknown> | null} scan
 * @returns {Record<string, unknown>}
 */
function summarizeScanForJson(scan) {
  if (!scan || typeof scan !== 'object') return {};
  const keys = [
    'contractAddress',
    'pairAddress',
    'tokenName',
    'ticker',
    'marketCap',
    'liquidity',
    'volume5m',
    'volume1h',
    'volume24h',
    'ageMinutes',
    'entryScore',
    'grade',
    'migrated',
    'dexPaid',
    'buySellRatio5m',
    'buySellRatio1h',
    'tradePressure',
    'volumeTrend',
    'trades5m',
    'trades1h',
    'trades24h',
    'buys24h',
    'holders',
    'priceChange5m',
    'priceUsd',
    'pairCreatedAt'
  ];
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of keys) {
    if (scan[k] !== undefined) out[k] = scan[k];
  }
  return out;
}

/**
 * @param {string} rawContract
 * @param {string} [profileName]
 * @returns {Promise<
 *   | { ok: false, error: string, detail?: string }
 *   | {
 *       ok: true;
 *       contractAddress: string;
 *       profile: string;
 *       note: string;
 *       scan: Record<string, unknown> | null;
 *       evaluation: object;
 *     }
 * >}
 */
async function analyzeContractForAdmin(rawContract, profileName) {
  const ca = extractSolanaContractAddress(rawContract);
  if (!ca) {
    return { ok: false, error: 'invalid_contract', detail: 'Paste a Solana mint (base58) or a DexScreener Solana URL.' };
  }

  const requested = String(profileName || '').trim();
  const profile =
    requested && autoCallConfig.profiles && autoCallConfig.profiles[requested]
      ? requested
      : autoCallConfig.defaultProfile;

  const scan = await generateRealScan(ca);

  if (!scan || scan.__monitorProviderSkip === true) {
    return {
      ok: true,
      contractAddress: ca,
      profile,
      note:
        'Live DexScreener-backed scan only (no GeckoTerminal candidate merge). Auto-call from the feed may differ slightly on migration/metadata.',
      scan: null,
      evaluation: evaluateAutoCallFiltersOnScan(scan, profile)
    };
  }

  return {
    ok: true,
    contractAddress: ca,
    profile,
    note:
      'Live DexScreener-backed scan only (no GeckoTerminal candidate merge). Auto-call from the feed may differ slightly on migration/metadata.',
    scan: summarizeScanForJson(scan),
    evaluation: evaluateAutoCallFiltersOnScan(scan, profile)
  };
}

module.exports = {
  analyzeContractForAdmin,
  extractSolanaContractAddress
};
