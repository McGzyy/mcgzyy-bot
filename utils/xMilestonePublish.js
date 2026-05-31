'use strict';

const { createPost, deleteTweet } = require('./xPoster');
const { buildXMilestonePostAssets } = require('./xMilestonePostAssets');
const {
  computeApprovalAthX,
  getApprovalTriggerX,
  getApprovalMilestoneLadder
} = require('./approvalMilestoneService');
const { setXPostState } = require('./trackedCallsService');
const { shouldKeepActiveQuote } = require('./xMilestoneQuotePolicy');

const DEFAULT_BROADCAST_RUNGS = [10, 25, 50, 100];

function normalizeRungList(list) {
  return [...new Set(list.map(n => Number(n)).filter(n => Number.isFinite(n) && n >= 1))].sort(
    (a, b) => a - b
  );
}

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

function resolveApprovalAnchorMilestone(currentX, postedMilestones = []) {
  const x = Number(currentX);
  if (!Number.isFinite(x) || x < 1) return 0;

  const ladder = getApprovalMilestoneLadder();
  if (!ladder.length) return 0;

  const posted = new Set(
    (Array.isArray(postedMilestones) ? postedMilestones : []).map(n => Number(n))
  );
  const eligible = ladder.filter(r => x >= r && !posted.has(r));
  if (!eligible.length) return 0;
  return Math.max(...eligible);
}

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
  // Lowest unposted rung first so 10× → 25× → 50× each get their own quote (not skip to max).
  return Math.min(...eligible);
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

function previousPostedMilestone(postedMilestones = []) {
  const nums = (Array.isArray(postedMilestones) ? postedMilestones : [])
    .map(n => Number(n))
    .filter(n => Number.isFinite(n) && n > 0);
  if (!nums.length) return 0;
  return Math.max(...nums);
}

/**
 * @param {number} currentX
 * @param {object} trackedCall
 * @returns {{
 *   kind: 'broadcast'|'ath_catchup',
 *   postMode: 'anchor'|'quote_update',
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

  const hasAnchor = Boolean(String(trackedCall?.xOriginalPostId || '').trim());
  let inner = null;

  const broadcast = resolveNextBroadcastMilestone(athX, posted);
  if (broadcast) {
    inner = {
      kind: 'broadcast',
      broadcastRung: broadcast,
      headlineX: Math.max(broadcast, athX),
      quotePreviousAthX: lastPostedAthX > 0 ? lastPostedAthX : 0
    };
  } else if (!hasAnchor && athX >= getApprovalTriggerX()) {
    const approvalRung = resolveApprovalAnchorMilestone(athX, posted);
    if (approvalRung) {
      inner = {
        kind: 'broadcast',
        broadcastRung: approvalRung,
        headlineX: Math.max(approvalRung, athX),
        quotePreviousAthX: lastPostedAthX > 0 ? lastPostedAthX : 0
      };
    }
  }

  if (!inner && athCatchUpEnabled() && posted.length) {
    const lastBroadcast = Math.max(...posted);
    const ladder = getBroadcastMilestoneLadder();
    const nextRung = ladder.find(r => r > lastBroadcast);
    if (nextRung == null || athX < nextRung) {
      if (!postedCatchUps.includes(lastBroadcast)) {
        const baseAth = lastPostedAthX > 0 ? lastPostedAthX : lastBroadcast;
        if (athX > baseAth + 0.05) {
          const minRatio = parseEnvFloat('X_MILESTONE_ATH_CATCHUP_RATIO', 1.2);
          const minDelta = parseEnvFloat('X_MILESTONE_ATH_CATCHUP_MIN_X', 12);
          if (athX >= baseAth * minRatio || athX >= baseAth + minDelta) {
            inner = {
              kind: 'ath_catchup',
              broadcastRung: lastBroadcast,
              headlineX: athX,
              quotePreviousAthX: baseAth
            };
          }
        }
      }
    }
  }

  if (!inner) return null;

  return {
    ...inner,
    postMode: hasAnchor ? 'quote_update' : 'anchor'
  };
}

function normalizeKeptQuoteIds(trackedCall) {
  const raw = Array.isArray(trackedCall?.xKeptQuotePostIds) ? trackedCall.xKeptQuotePostIds : [];
  return [...new Set(raw.map(id => String(id || '').trim()).filter(Boolean))];
}

/**
 * @param {object} trackedCall
 * @param {{ latestScan?: object|null, auditCategory?: string }} [opts]
 */
async function publishMilestoneToX(trackedCall, opts = {}) {
  if (!trackedCall || !trackedCall.xApproved) {
    return { success: false, reason: 'not_approved' };
  }

  if (!opts.bypassAutomationGate) {
    const { isXAutomationPaused } = require('./dashboardAutomationFlags');
    if (await isXAutomationPaused()) {
      return { success: false, reason: 'x_automation_paused' };
    }
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

  const isAnchor = plan.postMode === 'anchor';
  const anchorId = String(trackedCall?.xOriginalPostId || '').trim();
  const quoteTargetId = isAnchor ? '' : anchorId;

  if (!isAnchor && !quoteTargetId) {
    return { success: false, reason: 'missing_anchor' };
  }

  const quotePrev =
    !isAnchor && plan.quotePreviousAthX > 0 ? plan.quotePreviousAthX : 0;

  const assets = await buildXMilestonePostAssets(trackedCall, {
    milestoneX: plan.headlineX,
    headlineX: plan.headlineX,
    postRole: isAnchor ? 'anchor' : 'update',
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
          : isAnchor
            ? 'milestone_anchor'
            : 'milestone_user');

  const result = await createPost(assets.caption, null, assets.png || undefined, {
    quoteTweetId: quoteTargetId || undefined,
    audit: {
      category: milestoneAuditCat,
      callSourceType: trackedCall.callSourceType || null,
      quoted: Boolean(quoteTargetId)
    }
  });

  if (!result.success || !result.id) {
    return {
      success: false,
      reason: 'x_post_failed',
      error: result.error || null,
      milestoneX: plan.headlineX,
      kind: plan.kind,
      postMode: plan.postMode
    };
  }

  let deletedActiveQuote = false;
  let keptActiveQuote = false;
  const keptIds = normalizeKeptQuoteIds(trackedCall);
  const activeQuoteId = String(trackedCall?.xActiveQuotePostId || '').trim();

  if (!isAnchor && activeQuoteId && activeQuoteId !== result.id) {
    const decision = await shouldKeepActiveQuote(
      activeQuoteId,
      trackedCall.xActiveQuotePostedAt || null
    );
    if (decision.keep) {
      if (!keptIds.includes(activeQuoteId)) {
        keptIds.push(activeQuoteId);
      }
      keptActiveQuote = true;
      console.log(
        `[XMilestone] Keeping quote ${activeQuoteId} (${decision.reason}; ${decision.ageHours?.toFixed(1)}h, ♥${decision.likes ?? 0})`
      );
    } else {
      const del = await deleteTweet(activeQuoteId);
      deletedActiveQuote = del.success === true;
      console.log(
        `[XMilestone] Replace quote ${activeQuoteId} (${decision.reason}; deleted=${deletedActiveQuote})`
      );
    }
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

  const nowIso = new Date().toISOString();
  const updates = {
    xLastPostedAt: nowIso,
    xPostedMilestones: updatedMilestones,
    xPostedAthCatchUps: updatedCatchUps,
    xLatestMilestonePostId: result.id,
    xLastPostedAthX: plan.headlineX,
    xKeptQuotePostIds: keptIds
  };

  if (isAnchor) {
    updates.xOriginalPostId = result.id;
    updates.xActiveQuotePostId = null;
    updates.xActiveQuotePostedAt = null;
  } else {
    updates.xActiveQuotePostId = result.id;
    updates.xActiveQuotePostedAt = nowIso;
  }

  setXPostState(trackedCall.contractAddress, updates);

  const modeLabel = isAnchor ? 'anchor' : 'quote update';
  const kindLabel = plan.kind === 'ath_catchup' ? 'ATH catch-up' : 'broadcast';
  console.log(
    `[XMilestone] ${modeLabel} ${kindLabel} ${plan.headlineX}× for ${trackedCall.tokenName || trackedCall.contractAddress}` +
      (quoteTargetId ? ` (quote anchor ${quoteTargetId})` : '')
  );

  return {
    success: true,
    milestoneX: plan.headlineX,
    broadcastRung: plan.broadcastRung,
    kind: plan.kind,
    postMode: plan.postMode,
    postId: result.id,
    quoted: Boolean(quoteTargetId),
    keptActiveQuote,
    deletedActiveQuote,
    broadcast: plan.kind === 'broadcast'
  };
}

module.exports = {
  DEFAULT_BROADCAST_RUNGS,
  getBroadcastMilestoneLadder,
  resolveApprovalAnchorMilestone,
  resolveNextBroadcastMilestone,
  resolveMilestonePublishPlan,
  publishMilestoneToX
};
