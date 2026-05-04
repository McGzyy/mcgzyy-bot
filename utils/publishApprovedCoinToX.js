'use strict';

const { createPost } = require('./xPoster');
const { buildMilestoneHeroPng } = require('./milestoneHeroImage');
const {
  getHighestEligibleApprovalMilestone,
  computeApprovalAthX
} = require('./approvalMilestoneService');
const { getTrackedCall, setXPostState } = require('./trackedCallsService');
const { buildXPostText } = require('./buildXPostText');

/**
 * Post / reply on X for an approved coin when milestones qualify (same logic as monitoringEngine).
 * @param {string} contractAddress
 * @returns {Promise<{ success: boolean, reason?: string, error?: string | null, milestoneX?: number, reply?: boolean, postId?: string }>}
 */
async function publishApprovedCoinToX(contractAddress) {
  const trackedCall = getTrackedCall(contractAddress);
  if (!trackedCall) return { success: false, reason: 'missing_call' };
  if (!trackedCall.xApproved) return { success: false, reason: 'not_approved' };

  const milestoneX = getHighestEligibleApprovalMilestone(computeApprovalAthX(trackedCall));

  if (!milestoneX) {
    return { success: false, reason: 'no_milestone' };
  }

  const postedMilestones = Array.isArray(trackedCall.xPostedMilestones)
    ? trackedCall.xPostedMilestones
    : [];

  if (postedMilestones.includes(milestoneX)) {
    return { success: false, reason: 'already_posted' };
  }

  const hasOriginal = !!trackedCall.xOriginalPostId;

  const postText = await buildXPostText(trackedCall, {
    milestoneX,
    isReply: hasOriginal
  });

  let chartBuf = null;
  if (!hasOriginal) {
    try {
      chartBuf = await buildMilestoneHeroPng({
        milestoneX,
        seedKey: trackedCall.contractAddress || trackedCall.ticker || '',
        callSourceType: trackedCall.callSourceType,
        ticker: trackedCall.ticker
      });
    } catch (_e) {
      chartBuf = null;
    }
  }

  const result = await createPost(
    postText,
    hasOriginal ? trackedCall.xOriginalPostId : null,
    chartBuf || undefined
  );

  if (!result.success || !result.id) {
    return {
      success: false,
      reason: 'x_post_failed',
      error: result.error || null
    };
  }

  const updatedMilestones = [...postedMilestones, milestoneX].sort((a, b) => a - b);

  const updates = {
    xLastPostedAt: new Date().toISOString(),
    xPostedMilestones: updatedMilestones
  };

  if (!hasOriginal) {
    updates.xOriginalPostId = result.id;
  } else {
    updates.xLastReplyPostId = result.id;
  }

  setXPostState(contractAddress, updates);

  return {
    success: true,
    milestoneX,
    reply: hasOriginal,
    postId: result.id
  };
}

module.exports = {
  publishApprovedCoinToX
};
