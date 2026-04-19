'use strict';

const {
  initTrackedCallsStore,
  getTrackedCall,
  setApprovalStatus
} = require('./trackedCallsService');
const { recordModAction } = require('./modActionsService');
const {
  buildCompactCoinApprovalEmbed,
  resolveCoinDeletionKind,
  applyCompactFinalViewToMessage
} = require('./approvalMessageLifecycle');
const { publishApprovedCoinToX } = require('./publishApprovedCoinToX');

/**
 * Apply approve / deny / exclude from the dashboard (mirrors core Discord mod-approval effects).
 *
 * @param {import('discord.js').Client} discordClient
 * @param {{
 *   contractAddress: string,
 *   decision: 'approve' | 'deny' | 'exclude',
 *   moderatorId: string,
 *   moderatorUsername: string
 * }} opts
 * @returns {Promise<{ success: boolean, error?: string, discordMessageSkipped?: boolean, warning?: string, xPublish?: unknown }>}
 */
async function applyDashboardCallDecision(discordClient, opts) {
  await initTrackedCallsStore();

  const contractAddress = String(opts.contractAddress || '').trim();
  const decision = String(opts.decision || '').toLowerCase();
  const moderatorId = String(opts.moderatorId || '').trim();
  const moderatorUsername = String(opts.moderatorUsername || '').trim() || 'moderator';

  if (!contractAddress || !moderatorId) {
    return { success: false, error: 'Missing contractAddress or moderator id' };
  }
  if (!['approve', 'deny', 'exclude'].includes(decision)) {
    return { success: false, error: 'decision must be approve, deny, or exclude' };
  }

  const tracked = getTrackedCall(contractAddress);
  if (!tracked) {
    return { success: false, error: 'Tracked call not found' };
  }
  if (String(tracked.approvalStatus || '').toLowerCase() !== 'pending') {
    return { success: false, error: 'This approval is no longer pending' };
  }
  if (!tracked.approvalMessageId || !tracked.approvalChannelId) {
    return { success: false, error: 'Missing approval Discord message metadata' };
  }

  const statusMap = {
    approve: 'approved',
    deny: 'denied',
    exclude: 'excluded'
  };
  const nextStatus = statusMap[decision];

  /** @type {import('discord.js').GuildTextBasedChannel | null} */
  let textChannel = null;
  try {
    const ch = await discordClient.channels.fetch(String(tracked.approvalChannelId));
    if (ch && ch.isTextBased()) {
      textChannel = /** @type {import('discord.js').GuildTextBasedChannel} */ (ch);
    }
  } catch (_) {
    /* channel fetch failed — still persist decision */
  }

  const updated = setApprovalStatus(contractAddress, nextStatus, {
    moderatedById: moderatorId,
    moderatedByUsername: moderatorUsername
  });

  if (!updated) {
    return { success: false, error: 'Failed to persist approval status' };
  }

  const approvalKind = textChannel ? resolveCoinDeletionKind(textChannel) : 'coin';
  const actionTypeForApprove = approvalKind === 'premium' ? 'premium' : 'coin';

  const dedupeBase = `dashboard:${moderatorId}:${contractAddress}:${decision}:${Date.now()}`;

  if (decision === 'approve') {
    recordModAction({
      moderatorId,
      actionType: actionTypeForApprove,
      dedupeKey: dedupeBase
    });
  } else if (decision === 'deny') {
    recordModAction({
      moderatorId,
      actionType: 'coin_deny',
      dedupeKey: dedupeBase
    });
  } else {
    recordModAction({
      moderatorId,
      actionType: 'coin_exclude',
      dedupeKey: dedupeBase
    });
  }

  let xPublish = null;
  if (decision === 'approve') {
    try {
      xPublish = await publishApprovedCoinToX(contractAddress);
    } catch (e) {
      xPublish = {
        success: false,
        reason: 'exception',
        error: e && e.message ? String(e.message) : String(e)
      };
    }
  }

  const after = getTrackedCall(contractAddress);
  const embed = buildCompactCoinApprovalEmbed(after);
  const finalizeKind = approvalKind === 'premium' ? 'premium' : 'coin';

  if (!discordClient || !textChannel) {
    return {
      success: true,
      discordMessageSkipped: true,
      warning: 'Could not resolve approval channel to update Discord message',
      xPublish
    };
  }

  try {
    const msg = await textChannel.messages.fetch(String(tracked.approvalMessageId)).catch(() => null);
    if (!msg) {
      return {
        success: true,
        discordMessageSkipped: true,
        warning: 'Approval message not found (may have been deleted)',
        xPublish
      };
    }
    await applyCompactFinalViewToMessage(msg, embed, finalizeKind);
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    console.error('[dashboardCallApproval] Discord message finalize failed:', msg);
    return {
      success: true,
      discordMessageSkipped: true,
      warning: msg,
      xPublish
    };
  }

  return { success: true, xPublish };
}

module.exports = {
  applyDashboardCallDecision
};
