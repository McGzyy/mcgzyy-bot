'use strict';

const { createPost } = require('./xPoster');
const { buildXMilestonePostAssets } = require('./xMilestonePostAssets');
const { computeApprovalAthX, getApprovalTriggerX } = require('./approvalMilestoneService');
const { setXPostState } = require('./trackedCallsService');

const DEFAULT_BROADCAST_RUNGS = [10, 25, 50, 100];

function normalizeRungList(list) {
  return [...new Set(list.map(n => Number(n)).filter(n => Number.isFinite(n) && n >= 1))].sort(
    (a, b) => a - b
  );
}

/**
 * X feed rungs (subset of approval ladder). Env: `X_BROADCAST_MILESTONES=10,25,50,100`
 */
function getBroadcastMilestoneLadder() {
  const trigger = getApprovalTriggerX();
  let rungs = DEFAULT_BROADCAST_RUNGS;

  const raw = process.env.X_BROADCAST_MILESTONES;
  if (raw != null && String(raw).trim() !== '') {
    const parsed = String(raw)
      .split(/[,;\s]+/)
      .map(s => Number(String(s).trim()))
      .filter(n => Number.isFinite(n) && n >= 1);
    if (parsed.length) rungs = parsed;
  }

  return normalizeRungList(rungs.filter(r => r >= trigger));
}

/**
 * Highest broadcast rung the ATH qualifies for that is not yet on X (one post per invoke).
 * @param {number} currentX
 * @param {number[]} postedMilestones
 */
function resolveNextBroadcastMilestone(currentX, postedMilestones = []) {
  const x = Number(currentX);
  if (!Number.isFinite(x) || x < 1) return 0;

  const ladder = getBroadcastMilestoneLadder();
  if (!ladder.length) return 0;

  const posted = new Set(
    (Array.isArray(postedMilestones) ? postedMilestones : []).map(n => Number(n))
  );
  const eligible = ladder.filter(r => x >= r && !posted.has(r));
  if (!eligible.length) return 0;
  return Math.max(...eligible);
}

function roundAthX(x) {
  const n = Number(x);
  if (!Number.isFinite(n) || n < 1) return 0;
  const rounded = Math.round(n * 10) / 10;
  return rounded % 1 === 0 ? Math.round(rounded) : rounded;
}

function parseEnvFloat(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function athCatchUpEnabled() {
  const raw = String(process.env.X_MILESTONE_ATH_CATCHUP_ENABLED ?? '1')
    .trim()
    .toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no';
}

function quoteTweetsEnabled() {
  const raw = String(process.env.X_MILESTONE_QUOTE_PREVIOUS ?? '1')
    .trim()
    .toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no';
}

function previousPostedMilestone(postedMilestones = []) {
  const nums = (Array.isArray(postedMilestones) ? postedMilestones : [])
    .map(n => Number(n))
    .filter(n => Number.isFinite(n) && n > 0);
  if (!nums.length) return 0;
  return Math.max(...nums);
}

/**
 * What to post next: a new broadcast rung and/or an ATH catch-up between rungs.
 * @param {number} currentX
 * @param {object} trackedCall
 * @returns {{
 *   kind: 'broadcast'|'ath_catchup',
 *   broadcastRung: number,
 *   headlineX: number,
 *   quotePreviousAthX: number
 * }|null}
 */
function resolveMilestonePublishPlan(currentX, trackedCall) {
  const athX = roundAthX(currentX);
  if (athX < 1) return null;

  const posted = Array.isArray(trackedCall?.xPostedMilestones)
    ? trackedCall.xPostedMilestones.map(Number).filter(n => Number.isFinite(n) && n > 0)
    : [];
  const postedCatchUps = Array.isArray(trackedCall?.xPostedAthCatchUps)
    ? trackedCall.xPostedAthCatchUps.map(Number).filter(n => Number.isFinite(n) && n > 0)
    : [];
  const lastPostedAthX = roundAthX(
    Number(trackedCall?.xLastPostedAthX || 0) || previousPostedMilestone(posted)
  );

  const broadcast = resolveNextBroadcastMilestone(athX, posted);
  if (broadcast) {
    const prevAth = lastPostedAthX > 0 ? lastPostedAthX : 0;
    return {
      kind: 'broadcast',
      broadcastRung: broadcast,
      headlineX: Math.max(broadcast, athX),
      quotePreviousAthX: prevAth
    };
  }

  if (!athCatchUpEnabled() || !posted.length) return null;

  const lastBroadcast = Math.max(...posted);
  const ladder = getBroadcastMilestoneLadder();
  const nextRung = ladder.find(r => r > lastBroadcast);
  if (nextRung != null && athX >= nextRung) return null;

  if (postedCatchUps.includes(lastBroadcast)) return null;

  const baseAth = lastPostedAthX > 0 ? lastPostedAthX : lastBroadcast;
  if (athX <= baseAth + 0.05) return null;

  const minRatio = parseEnvFloat('X_MILESTONE_ATH_CATCHUP_RATIO', 1.2);
  const minDelta = parseEnvFloat('X_MILESTONE_ATH_CATCHUP_MIN_X', 12);
  const grewEnough = athX >= baseAth * minRatio || athX >= baseAth + minDelta;
  if (!grewEnough) return null;

  return {
    kind: 'ath_catchup',
    broadcastRung: lastBroadcast,
    headlineX: athX,
    quotePreviousAthX: baseAth
  };
}

/**
 * Prior milestone tweet to quote (standalone chain only).
 * @param {object} trackedCall
 */
function resolveQuoteTweetId(trackedCall) {
  if (!quoteTweetsEnabled()) return null;
  const id =
    String(trackedCall?.xLatestMilestonePostId || '').trim() ||
    String(trackedCall?.xOriginalPostId || '').trim();
  return id || null;
}

/**
 * Publish one standalone milestone (+ optional quote of the last milestone tweet).
 * @param {object} trackedCall
 * @param {{ latestScan?: object|null, auditCategory?: string }} [opts]
 */
async function publishMilestoneToX(trackedCall, opts = {}) {
  if (!trackedCall || !trackedCall.xApproved) {
    return { success: false, reason: 'not_approved' };
  }

  const currentX = computeApprovalAthX(trackedCall);
  const plan = resolveMilestonePublishPlan(currentX, trackedCall);
  if (!plan) {
    return { success: false, reason: 'no_broadcast_milestone' };
  }

  const postedMilestones = Array.isArray(trackedCall.xPostedMilestones)
    ? trackedCall.xPostedMilestones
    : [];
  const postedCatchUps = Array.isArray(trackedCall.xPostedAthCatchUps)
    ? trackedCall.xPostedAthCatchUps
    : [];

  const quoteTweetId = resolveQuoteTweetId(trackedCall);
  const quotePrev =
    quoteTweetId && plan.quotePreviousAthX > 0 ? plan.quotePreviousAthX : 0;

  const assets = await buildXMilestonePostAssets(trackedCall, {
    milestoneX: plan.headlineX,
    headlineX: plan.headlineX,
    isReply: false,
    latestScan: opts.latestScan || null,
    quotePreviousMilestone: quotePrev
  });

  if (assets.replyPending) {
    return { success: false, reason: 'reply_card_pending' };
  }

  const srcForAudit = String(trackedCall.callSourceType || 'user_call').toLowerCase();
  const milestoneAuditCat =
    opts.auditCategory ||
    (srcForAudit === 'bot_call'
      ? 'milestone_bot'
      : srcForAudit === 'watch_only'
        ? 'milestone_watch'
        : plan.kind === 'ath_catchup'
          ? 'milestone_ath_catchup'
          : 'milestone_user');

  const result = await createPost(assets.caption, null, assets.png || undefined, {
    quoteTweetId,
    audit: {
      category: milestoneAuditCat,
      callSourceType: trackedCall.callSourceType || null,
      quoted: Boolean(quoteTweetId)
    }
  });

  if (!result.success || !result.id) {
    return {
      success: false,
      reason: 'x_post_failed',
      error: result.error || null,
      milestoneX: plan.headlineX,
      kind: plan.kind
    };
  }

  let updatedMilestones = [...postedMilestones];
  let updatedCatchUps = [...postedCatchUps];

  if (plan.kind === 'broadcast') {
    updatedMilestones = [...updatedMilestones, plan.broadcastRung]
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => a - b);
  } else {
    updatedCatchUps = [...updatedCatchUps, plan.broadcastRung]
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => a - b);
  }

  const updates = {
    xLastPostedAt: new Date().toISOString(),
    xPostedMilestones: updatedMilestones,
    xPostedAthCatchUps: updatedCatchUps,
    xLatestMilestonePostId: result.id,
    xLastPostedAthX: plan.headlineX
  };

  if (!trackedCall.xOriginalPostId) {
    updates.xOriginalPostId = result.id;
  }

  setXPostState(trackedCall.contractAddress, updates);

  const kindLabel = plan.kind === 'ath_catchup' ? 'ATH catch-up' : 'broadcast';
  console.log(
    `[XMilestone] ${kindLabel} ${plan.headlineX}× (rung ${plan.broadcastRung}×) for ${trackedCall.tokenName || trackedCall.contractAddress}` +
      (quoteTweetId ? ` (quote ${quoteTweetId})` : '')
  );

  return {
    success: true,
    milestoneX: plan.headlineX,
    broadcastRung: plan.broadcastRung,
    kind: plan.kind,
    postId: result.id,
    quoted: Boolean(quoteTweetId),
    broadcast: plan.kind === 'broadcast'
  };
}

module.exports = {
  DEFAULT_BROADCAST_RUNGS,
  getBroadcastMilestoneLadder,
  resolveNextBroadcastMilestone,
  resolveMilestonePublishPlan,
  publishMilestoneToX
};
