/**
 * Single entry for matching call-side metadata (wallet / X) to curated tracked devs.
 * Intended for future automatic dev attribution — read-only, no registry writes.
 */

const {
  getTrackedDev,
  getTrackedDevByXHandle,
  normalizeStoredDevXHandle,
  isLikelySolWallet
} = require('./devRegistryService');

function normalizeWalletInput(wallet) {
  return String(wallet || '').trim();
}

/**
 * Resolve a dev from wallet and/or primary X handle.
 *
 * @param {{ wallet?: string, xHandle?: string }} input
 * @returns {{
 *   dev: object|null,
 *   matchedBy?: 'wallet'|'x_handle'|'wallet_and_x',
 *   conflict?: boolean,
 *   reason?: string,
 *   byWallet?: object|null,
 *   byX?: object|null
 * }}
 */
function resolveTrackedDevIdentity(input = {}) {
  const w = normalizeWalletInput(input.wallet);
  const walletKey = w && isLikelySolWallet(w) ? w : '';

  const xNorm = normalizeStoredDevXHandle(input.xHandle);
  if (!walletKey && !xNorm) {
    return { dev: null, reason: 'empty_identity' };
  }

  const byWallet = walletKey ? getTrackedDev(walletKey) : null;
  const byX = xNorm ? getTrackedDevByXHandle(xNorm) : null;

  if (byWallet && byX) {
    if (byWallet.walletAddress === byX.walletAddress) {
      const matchedBy =
        walletKey && xNorm ? 'wallet_and_x' : walletKey ? 'wallet' : 'x_handle';
      return { dev: byWallet, matchedBy };
    }
    return {
      dev: null,
      conflict: true,
      reason: 'wallet_x_mismatch',
      byWallet,
      byX
    };
  }

  if (byWallet) return { dev: byWallet, matchedBy: 'wallet' };
  if (byX) return { dev: byX, matchedBy: 'x_handle' };
  return { dev: null, reason: 'not_found' };
}

module.exports = {
  resolveTrackedDevIdentity,
  normalizeWalletInput
};
