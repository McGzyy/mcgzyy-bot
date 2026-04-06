/**
 * X milestone post preview / dry-run helpers (no network).
 */

const {
  computeApprovalAthX,
  getHighestEligibleApprovalMilestone,
  getApprovalMilestoneLadder,
  getApprovalTriggerX
} = require('./approvalMilestoneService');
const {
  buildXPostTextApproval,
  buildXPostTextMonitor,
  resolveCallerApproval,
  resolveCallerMonitor
} = require('./xPostContent');
const {
  isMilestoneChartAttachmentEnabled,
  canAttemptDexChart
} = require('./tokenChartImage');

function isXPostDryRunEnabled() {
  const v = String(process.env.X_POST_DRY_RUN || process.env.X_POST_PREVIEW || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Inspect what would be posted for an approved tracked call (approval + monitor templates).
 * @param {object} trackedCall
 * @param {object} [options]
 * @param {number|null} [options.forceMilestoneX] — override ladder-derived milestone for “what if” previews
 */
function describeXPostForTrackedCall(trackedCall, options = {}) {
  const { forceMilestoneX = null } = options;

  const currentX = computeApprovalAthX(trackedCall);
  const milestoneX =
    forceMilestoneX != null && Number.isFinite(Number(forceMilestoneX)) && Number(forceMilestoneX) > 0
      ? Number(forceMilestoneX)
      : getHighestEligibleApprovalMilestone(currentX);

  const postedMilestones = Array.isArray(trackedCall.xPostedMilestones)
    ? trackedCall.xPostedMilestones
    : [];

  const alreadyPosted = milestoneX > 0 && postedMilestones.includes(milestoneX);
  const hasOriginal = !!trackedCall.xOriginalPostId;
  const replyToTweetId = hasOriginal ? trackedCall.xOriginalPostId : null;
  const isReply = hasOriginal;

  const textApproval =
    milestoneX > 0 ? buildXPostTextApproval(trackedCall, milestoneX, isReply) : '';
  const textMonitor =
    milestoneX > 0 ? buildXPostTextMonitor(trackedCall, milestoneX, isReply) : '';

  return {
    contractAddress: trackedCall.contractAddress,
    tokenName: trackedCall.tokenName,
    ticker: trackedCall.ticker,
    xApproved: !!trackedCall.xApproved,
    currentAthMultiple: currentX,
    approvalTriggerX: getApprovalTriggerX(),
    ladder: getApprovalMilestoneLadder(),
    milestoneX,
    milestoneEligible: milestoneX > 0,
    alreadyPostedThisMilestone: alreadyPosted,
    postedMilestones: [...postedMilestones].sort((a, b) => a - b),
    postKind: isReply ? 'reply' : 'original',
    replyToTweetId,
    threading: {
      mode: 'reply_to_original_only',
      explanation:
        isReply && replyToTweetId
          ? 'API sends reply with in_reply_to_tweet_id = stored xOriginalPostId (first post). Later milestones are also direct replies to that same tweet, not to the previous reply — flat thread under the OP.'
          : 'No xOriginalPostId yet: next real post would be an original tweet; id is saved as xOriginalPostId for later replies.'
    },
    callerCreditApproval: resolveCallerApproval(trackedCall),
    callerCreditMonitor: resolveCallerMonitor(trackedCall, 'Unknown'),
    bodyApprovalTemplate: textApproval,
    bodyMonitorTemplate: textMonitor,
    dryRunEnvActive: isXPostDryRunEnabled(),
    milestoneChartAttachmentEnabled: isMilestoneChartAttachmentEnabled(),
    chartSpecCanBuild: canAttemptDexChart(trackedCall)
  };
}

module.exports = {
  isXPostDryRunEnabled,
  describeXPostForTrackedCall
};
