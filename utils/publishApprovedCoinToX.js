'use strict';

const { getTrackedCall } = require('./trackedCallsService');
const { publishMilestoneToX } = require('./xMilestonePublish');

/**
 * Post a standalone broadcast milestone to X for an approved coin.
 * @param {string} contractAddress
 */
async function publishApprovedCoinToX(contractAddress) {
  const trackedCall = getTrackedCall(contractAddress);
  if (!trackedCall) return { success: false, reason: 'missing_call' };
  if (!trackedCall.xApproved) return { success: false, reason: 'not_approved' };

  return publishMilestoneToX(trackedCall, {
    latestScan: null,
    auditCategory: 'approval_publish'
  });
}

module.exports = {
  publishApprovedCoinToX
};
