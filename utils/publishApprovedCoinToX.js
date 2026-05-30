'use strict';

const { getTrackedCall } = require('./trackedCallsService');
const { publishMilestoneToX } = require('./xMilestonePublish');

/**
 * Post a standalone broadcast milestone to X for an approved coin.
 * @param {string} contractAddress
 */
async function publishApprovedCoinToX(contractAddress) {
  const addr = String(contractAddress || '').trim();
  if (!addr) return { success: false, reason: 'missing_call' };

  const maxBurst = (() => {
    const n = Number(process.env.X_MILESTONE_BURST_ON_APPROVE ?? 4);
    return Number.isFinite(n) && n > 0 ? Math.min(8, Math.floor(n)) : 4;
  })();

  let last = null;
  for (let i = 0; i < maxBurst; i += 1) {
    const trackedCall = getTrackedCall(addr);
    if (!trackedCall) return last || { success: false, reason: 'missing_call' };
    if (!trackedCall.xApproved) return last || { success: false, reason: 'not_approved' };

    last = await publishMilestoneToX(trackedCall, {
      latestScan: null,
      auditCategory: 'approval_publish'
    });
    if (!last?.success) break;
    if (last.reason === 'no_broadcast_milestone') break;
  }

  const result = last || { success: false, reason: 'no_broadcast_milestone' };
  if (!result.success) {
    console.warn(
      `[publishApprovedCoinToX] X post failed for ${addr}: ${result.reason || 'unknown'}` +
        (result.error ? ` (${result.error})` : '')
    );
  }
  return result;
}

module.exports = {
  publishApprovedCoinToX
};
