'use strict';

const { createPost } = require('./xPoster');
const {
  buildOhlcvCandlestickBufferForTrackedCall
} = require('./ohlcvCandlestickBuffer');
const {
  getHighestEligibleApprovalMilestone,
  computeApprovalAthX
} = require('./approvalMilestoneService');
const { getTrackedCall, setXPostState } = require('./trackedCallsService');

function formatUsd(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'N/A';
  return `$${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function buildXPostText(trackedCall) {
  const ticker = trackedCall.ticker || 'UNKNOWN';
  const ca = trackedCall.contractAddress || '';
  const firstCalledMc = Number(trackedCall.firstCalledMarketCap || 0);
  const latestMc = Number(
    trackedCall.latestMarketCap ||
      trackedCall.firstCalledMarketCap ||
      0
  );
  const displayX =
    firstCalledMc > 0 ? Number((latestMc / firstCalledMc).toFixed(2)) : 0;

  const initialMcStr = formatUsd(firstCalledMc);
  const athMcStr = formatUsd(
    trackedCall.ath ||
      trackedCall.athMc ||
      trackedCall.athMarketCap ||
      trackedCall.latestMarketCap ||
      trackedCall.firstCalledMarketCap ||
      0
  );

  return [
    `🚀 $${ticker} — ${displayX.toFixed(2)}x from call`,
    ``,
    `Called by: @McGBot`,
    ``,
    `Initial MC: ${initialMcStr}`,
    `ATH MC: ${athMcStr}`,
    ``,
    `CA:`,
    `\`${ca}\``,
    ``,
    `📊 DexScreener: https://dexscreener.com/solana/${ca}`,
    `📊 GMGN: https://gmgn.ai/sol/token/${ca}`
  ].join('\n');
}

/**
 * Post / reply on X for an approved coin when milestones qualify (same logic as bot index).
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

  const postText = buildXPostText(trackedCall);

  let chartBuf = null;
  if (!hasOriginal) {
    chartBuf = await buildOhlcvCandlestickBufferForTrackedCall(trackedCall, null);
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
  publishApprovedCoinToX,
  buildXPostText
};
