'use strict';

const { buildXPostText } = require('./buildXPostText');
const { createPost, normalizePngUploadBuffer } = require('./xPoster');
const { buildMilestoneHeroPng } = require('./milestoneHeroImage');
const { getHighestEligibleApprovalMilestone } = require('./approvalMilestoneService');

const DEFAULT_WRAP_SOL = 'So11111111111111111111111111111111111111112';

/**
 * @param {{ variant: 'user' | 'bot', milestoneAthX: number, spotX?: number|null, contractAddress?: string|null, firstCallerDiscordId?: string|null }}
 */
function buildSyntheticTrackedCallForXMilestoneTest(p) {
  const variant = p.variant === 'bot' ? 'bot' : 'user';
  const ca = String(p.contractAddress || '').trim() || DEFAULT_WRAP_SOL;
  const mult = Number(p.milestoneAthX);
  const m = Number.isFinite(mult) && mult >= 1.01 ? mult : 8;
  const spotRaw = p.spotX != null ? Number(p.spotX) : m * 0.94;
  const spot = Number.isFinite(spotRaw) && spotRaw > 0 ? Math.min(spotRaw, m * 0.999) : m * 0.94;
  const entry = 400_000;
  const athMc = entry * m;
  const latestMc = entry * spot;

  return {
    contractAddress: ca,
    ticker: 'TEST',
    tokenName: 'Milestone layout test',
    firstCalledMarketCap: entry,
    latestMarketCap: latestMc,
    ath: athMc,
    athMc: athMc,
    athMarketCap: athMc,
    callSourceType: variant === 'bot' ? 'bot_call' : 'user_call',
    firstCallerDiscordId: variant === 'user' ? p.firstCallerDiscordId || null : null,
    xApproved: true
  };
}

/**
 * Owner-only X preview: approval-style milestone post (does not touch tracked-call X state).
 *
 * @param {{
 *   variant: 'user' | 'bot',
 *   replyToTweetId?: string | null,
 *   headlineMilestoneX: number,
 *   contractAddress?: string | null,
 *   firstCallerDiscordId?: string | null
 * }} p
 * @returns {Promise<{ success: boolean, id?: string|null, error?: unknown, textLength?: number, chartAttached?: boolean }>}
 */
async function postTestMilestoneToX(p) {
  const variant = p.variant === 'bot' ? 'bot' : 'user';
  const replyTo = p.replyToTweetId ? String(p.replyToTweetId).trim() : '';
  const isReply = !!replyTo;
  const mx = Number(p.headlineMilestoneX);
  if (!Number.isFinite(mx) || mx < 2) {
    return { success: false, error: 'headlineMilestoneX must be >= 2' };
  }

  const envCa = String(process.env.X_TEST_MILESTONE_CONTRACT || '').trim();
  const ca = (p.contractAddress && String(p.contractAddress).trim()) || envCa || DEFAULT_WRAP_SOL;

  const tracked = buildSyntheticTrackedCallForXMilestoneTest({
    variant,
    milestoneAthX: mx,
    spotX: mx * (isReply ? 0.96 : 0.93),
    contractAddress: ca,
    firstCallerDiscordId: p.firstCallerDiscordId || null
  });

  const postText = await buildXPostText(tracked, {
    milestoneX: mx,
    isReply
  });

  let chartBuf = null;
  if (!isReply) {
    try {
      const raw = await buildMilestoneHeroPng({
        milestoneX: mx,
        seedKey: ca,
        callSourceType: tracked.callSourceType,
        ticker: tracked.ticker
      });
      chartBuf = normalizePngUploadBuffer(raw);
    } catch (_e) {
      chartBuf = null;
    }
  }

  const result = await createPost(postText, isReply ? replyTo : null, chartBuf || undefined, {
    audit: {
      category: 'manual_test_milestone',
      callSourceType: tracked.callSourceType || null
    }
  });
  return {
    success: !!result.success,
    id: result.id || null,
    error: result.error,
    textLength: postText.length,
    chartAttached: !!chartBuf && !isReply
  };
}

function defaultOriginalMilestoneX() {
  return getHighestEligibleApprovalMilestone(12) || 8;
}

function defaultReplyMilestoneX() {
  return getHighestEligibleApprovalMilestone(45) || 30;
}

module.exports = {
  postTestMilestoneToX,
  buildSyntheticTrackedCallForXMilestoneTest,
  defaultOriginalMilestoneX,
  defaultReplyMilestoneX
};
