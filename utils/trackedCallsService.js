const fs = require('fs');
const path = require('path');
const {
  upsertUserProfile,
  resolvePublicCallerName
} = require('../utils/userProfileService');

const trackedCallsFilePath = path.join(__dirname, '../data/trackedCalls.json');

function loadTrackedCalls() {
  try {
    if (!fs.existsSync(trackedCallsFilePath)) {
      fs.writeFileSync(trackedCallsFilePath, JSON.stringify([], null, 2));
    }

    const rawData = fs.readFileSync(trackedCallsFilePath, 'utf-8');
    const calls = JSON.parse(rawData);

    return Array.isArray(calls)
      ? calls.map(normalizeTrackedCall)
      : [];
  } catch (error) {
    console.error('[TrackedCalls] Failed to load tracked calls:', error.message);
    return [];
  }
}

function saveTrackedCalls(calls) {
  try {
    fs.writeFileSync(trackedCallsFilePath, JSON.stringify(calls, null, 2));
  } catch (error) {
    console.error('[TrackedCalls] Failed to save tracked calls:', error.message);
  }
}

function resetAllTrackedCalls() {
  saveTrackedCalls([]);
  return { cleared: true };
}

function normalizeTrackedCall(call = {}) {
  const normalized = {
    ...call,

    milestonesHit: Array.isArray(call.milestonesHit) ? call.milestonesHit : [],
    dumpAlertsHit: Array.isArray(call.dumpAlertsHit) ? call.dumpAlertsHit : [],
    priceHistory: Array.isArray(call.priceHistory) ? call.priceHistory : [],
    lifecycleStatus: call.lifecycleStatus || 'active',
    isActive: call.isActive !== false,

    callSourceType: call.callSourceType || 'user_call', // user_call | watch_only | bot_call
    wasWatched: call.wasWatched === true,

    approvalStatus: call.approvalStatus || 'none',
    excludedFromStats: call.excludedFromStats === true,
    moderationTags: Array.isArray(call.moderationTags) ? call.moderationTags : [],
    moderationNotes: typeof call.moderationNotes === 'string' ? call.moderationNotes : '',
    moderatedById: call.moderatedById || null,
    moderatedByUsername: call.moderatedByUsername || null,
    moderatedAt: call.moderatedAt || null,

    approvalMessageId: call.approvalMessageId || null,
    approvalChannelId: call.approvalChannelId || null,
    approvalRequestedAt: call.approvalRequestedAt || null,
    approvalExpiresAt: call.approvalExpiresAt || null,
    lastApprovalTriggerX: Number(call.lastApprovalTriggerX || 0),

    approvalMilestonesTriggered: Array.isArray(call.approvalMilestonesTriggered)
      ? call.approvalMilestonesTriggered
      : [],

    xApproved: call.xApproved === true,
    xPostedMilestones: Array.isArray(call.xPostedMilestones)
      ? call.xPostedMilestones
      : [],
    lastPostedX: Number(call.lastPostedX || 0),
    xOriginalPostId: call.xOriginalPostId || null,
    xLastReplyPostId: call.xLastReplyPostId || null,
    xLastPostedAt: call.xLastPostedAt || null
  };

  return refreshPublicCallerName(normalized);
}

function getTrackedCall(contractAddress) {
  const calls = loadTrackedCalls();
  return calls.find(call => call.contractAddress === contractAddress) || null;
}

function getAllTrackedCalls() {
  return loadTrackedCalls();
}

function getRecentBotCalls(limit = 10) {
  const tracked = getAllTrackedCalls();

  return tracked
    .filter(call => call.callSourceType === 'bot_call')
    .sort((a, b) => {
      const aTime = new Date(a.calledAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.calledAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    })
    .slice(0, limit);
}

function getPendingApprovals(limit = 10) {
  const tracked = getAllTrackedCalls();

  return tracked
    .filter(call =>
      String(call.approvalStatus || '').toLowerCase() === 'pending' &&
      !!call.approvalRequestedAt &&
      !!call.approvalMessageId
    )
    .sort((a, b) => {
      const aTime = new Date(a.approvalRequestedAt || 0).getTime();
      const bTime = new Date(b.approvalRequestedAt || 0).getTime();
      return bTime - aTime;
    })
    .slice(0, limit);
}

function getApprovalStats() {
  const tracked = getAllTrackedCalls();

  const stats = {
    pending: 0,
    approved: 0,
    denied: 0,
    expiredOrCleared: 0,
    totalTracked: tracked.length
  };

  for (const call of tracked) {
    const status = String(call.approvalStatus || '').toLowerCase();

    if (status === 'pending') {
      stats.pending += 1;
    } else if (status === 'approved') {
      stats.approved += 1;
    } else if (status === 'denied') {
      stats.denied += 1;
    }

    const hadApprovalFlow =
      call.approvalRequestedAt ||
      call.approvalExpiresAt ||
      call.approvalMessageId ||
      call.approvalChannelId;

    const isCleared =
      hadApprovalFlow &&
      !call.approvalMessageId &&
      !call.approvalChannelId &&
      !call.approvalRequestedAt &&
      !call.approvalExpiresAt &&
      status !== 'pending' &&
      status !== 'approved' &&
      status !== 'denied';

    if (isCleared) {
      stats.expiredOrCleared += 1;
    }
  }

  return stats;
}
/**
 * =========================
 * CALLER PROFILE SYNC
 * =========================
 */

function syncCallerProfile(callerId = null, callerUsername = 'Unknown', callerDisplayName = '') {
  try {
    if (!callerId && !callerUsername && !callerDisplayName) return null;

    if (String(callerId || '').toUpperCase() === 'AUTO_BOT') {
      return null;
    }

    return upsertUserProfile({
      discordUserId: callerId ? String(callerId) : null,
      username: callerUsername || '',
      displayName: callerDisplayName || callerUsername || ''
    });
  } catch (error) {
    console.error('[TrackedCalls] Failed to sync caller profile:', error.message);
    return null;
  }
}

function buildCallerFields(
  callerId = null,
  callerUsername = 'Unknown',
  callerDisplayName = '',
  options = {}
) {
  const callSourceType = options.callSourceType || 'user_call';
  const isBotCall = callSourceType === 'bot_call';

  if (isBotCall) {
  return {
    firstCallerId: 'AUTO_BOT',
    firstCallerUsername: 'McGBot',
    firstCallerDiscordId: 'AUTO_BOT',
    firstCallerDisplayName: 'McGBot',
    firstCallerPublicName: 'McGBot'
  };
}

  const syncedProfile = syncCallerProfile(callerId, callerUsername, callerDisplayName);

  const discordUserId = callerId ? String(callerId) : null;
  const username = callerUsername || 'Unknown';
  const displayName = callerDisplayName || callerUsername || 'Unknown';

  const publicName = resolvePublicCallerName({
    discordUserId,
    username,
    displayName,
    fallback: displayName || username || 'Unknown'
  });

  return {
    firstCallerId: discordUserId,
    firstCallerUsername: username,
    firstCallerDiscordId: discordUserId,
    firstCallerDisplayName: displayName,
    firstCallerPublicName:
      publicName ||
      syncedProfile?.publicSettings?.publicAlias ||
      syncedProfile?.displayName ||
      syncedProfile?.username ||
      displayName ||
      username ||
      'Unknown'
  };
}

function refreshPublicCallerName(call = {}) {
  const normalized = { ...call };

  const looksLikeBotCall =
    normalized.callSourceType === 'bot_call' ||
    String(normalized.firstCallerId || '').toUpperCase() === 'AUTO_BOT' ||
    String(normalized.firstCallerDiscordId || '').toUpperCase() === 'AUTO_BOT' ||
    String(normalized.firstCallerUsername || '').toLowerCase() === 'mcgbot' ||
    String(normalized.firstCallerDisplayName || '').toLowerCase() === 'mcgbot' ||
    String(normalized.firstCallerPublicName || '').toLowerCase() === 'mcgbot';

  if (looksLikeBotCall) {
    normalized.callSourceType = 'bot_call';
    normalized.firstCallerId = 'AUTO_BOT';
    normalized.firstCallerUsername = 'McGBot';
    normalized.firstCallerDiscordId = 'AUTO_BOT';
    normalized.firstCallerDisplayName = 'McGBot';
    normalized.firstCallerPublicName = 'McGBot';
    return normalized;
  }

  if (normalized.callSourceType === 'watch_only') {
    return {
      ...normalized,
      firstCallerId: normalized.firstCallerId || null,
      firstCallerUsername: normalized.firstCallerUsername || null,
      firstCallerDiscordId: normalized.firstCallerDiscordId || null,
      firstCallerDisplayName: normalized.firstCallerDisplayName || null,
      firstCallerPublicName:
        normalized.firstCallerPublicName ||
        normalized.firstCallerDisplayName ||
        normalized.firstCallerUsername ||
        null
    };
  }

  normalized.firstCallerPublicName = resolvePublicCallerName({
    discordUserId: normalized.firstCallerDiscordId || normalized.firstCallerId || null,
    username: normalized.firstCallerUsername || '',
    displayName: normalized.firstCallerDisplayName || '',
    trackedCall: normalized,
    fallback:
      normalized.firstCallerDisplayName ||
      normalized.firstCallerUsername ||
      normalized.firstCallerPublicName ||
      'Unknown'
  });

  return normalized;
}

/**
 * =========================================
 * IMPORTANT:
 * FIRST CALLER OWNERSHIP MUST NEVER BE OVERWRITTEN
 * =========================================
 */
function saveTrackedCall(
  scan,
  callerId = null,
  callerUsername = 'Unknown',
  callerDisplayName = '',
  options = {}
) {
  const calls = loadTrackedCalls();
  const existingIndex = calls.findIndex(call => call.contractAddress === scan.contractAddress);
  const now = new Date().toISOString();

  const callSourceType =
    options.callSourceType === 'watch_only'
      ? 'watch_only'
      : options.callSourceType === 'bot_call'
        ? 'bot_call'
        : 'user_call';

  const callerFields = buildCallerFields(
    callerId,
    callerUsername,
    callerDisplayName,
    { callSourceType }
  );

  const wasWatched = callSourceType === 'watch_only';

  if (existingIndex !== -1) {
    const existing = normalizeTrackedCall(calls[existingIndex]);

    const shouldUpgradeWatchToCall =
      existing.callSourceType === 'watch_only' && callSourceType === 'user_call';

    const shouldUpgradeBotToUser =
      existing.callSourceType === 'bot_call' && callSourceType === 'user_call';

    const shouldPreserveExistingCaller =
      !shouldUpgradeWatchToCall &&
      !shouldUpgradeBotToUser &&
      existing.callSourceType === 'user_call';

    const updated = normalizeTrackedCall({
      ...existing,

      tokenName: scan.tokenName || existing.tokenName,
      ticker: scan.ticker || existing.ticker,
      contractAddress: scan.contractAddress || existing.contractAddress,
      latestMarketCap: scan.marketCap ?? existing.latestMarketCap,
      entryScore: scan.entryScore ?? existing.entryScore,
      grade: scan.grade ?? existing.grade,
      alertType: scan.alertType ?? existing.alertType,
      lastUpdatedAt: now,

      athMc: Math.max(
        Number(existing.athMc || existing.latestMarketCap || existing.firstCalledMarketCap || 0),
        Number(scan.marketCap || 0)
      ),

      milestonesHit: Array.isArray(existing.milestonesHit) ? existing.milestonesHit : [],
      dumpAlertsHit: Array.isArray(existing.dumpAlertsHit) ? existing.dumpAlertsHit : [],
      lifecycleStatus: existing.lifecycleStatus || 'active',
      isActive: existing.isActive !== false,

      priceHistory: (() => {
        const prev = Array.isArray(existing.priceHistory) ? [...existing.priceHistory] : [];
        const mc = Number(scan.marketCap || 0);
        if (mc <= 0) return prev;
        if (prev.length === 0) return [{ t: Date.now(), price: mc }];
        prev.push({ t: Date.now(), price: mc });
        return prev.slice(-500);
      })(),

      discordMessageId: existing.discordMessageId || null,

      firstCallerId:
        shouldPreserveExistingCaller
          ? existing.firstCallerId
          : (shouldUpgradeWatchToCall || shouldUpgradeBotToUser
              ? callerFields.firstCallerId
              : existing.firstCallerId || callerFields.firstCallerId),

      firstCallerUsername:
        shouldPreserveExistingCaller
          ? existing.firstCallerUsername
          : (shouldUpgradeWatchToCall || shouldUpgradeBotToUser
              ? callerFields.firstCallerUsername
              : existing.firstCallerUsername || callerFields.firstCallerUsername),

      firstCallerDiscordId:
        shouldPreserveExistingCaller
          ? existing.firstCallerDiscordId
          : (shouldUpgradeWatchToCall || shouldUpgradeBotToUser
              ? callerFields.firstCallerDiscordId
              : existing.firstCallerDiscordId || callerFields.firstCallerDiscordId),

      firstCallerDisplayName:
        shouldPreserveExistingCaller
          ? existing.firstCallerDisplayName
          : (shouldUpgradeWatchToCall || shouldUpgradeBotToUser
              ? callerFields.firstCallerDisplayName
              : existing.firstCallerDisplayName || callerFields.firstCallerDisplayName),

      firstCallerPublicName:
        shouldPreserveExistingCaller
          ? existing.firstCallerPublicName
          : (shouldUpgradeWatchToCall || shouldUpgradeBotToUser
              ? callerFields.firstCallerPublicName
              : existing.firstCallerPublicName || callerFields.firstCallerPublicName),

      firstCalledAt:
        shouldUpgradeWatchToCall || shouldUpgradeBotToUser
          ? now
          : (existing.firstCalledAt || now),

      firstCalledMarketCap:
        shouldUpgradeWatchToCall || shouldUpgradeBotToUser
          ? (scan.marketCap ?? existing.firstCalledMarketCap)
          : (existing.firstCalledMarketCap ?? scan.marketCap),

      callSourceType:
        shouldUpgradeWatchToCall || shouldUpgradeBotToUser
          ? 'user_call'
          : (
              existing.callSourceType === 'bot_call' && callSourceType === 'bot_call'
                ? 'bot_call'
                : existing.callSourceType || callSourceType
            ),

      wasWatched: existing.wasWatched === true || wasWatched === true,

      approvalStatus: existing.approvalStatus || 'none',
      excludedFromStats: existing.excludedFromStats === true,
      moderationTags: Array.isArray(existing.moderationTags) ? existing.moderationTags : [],
      moderationNotes: typeof existing.moderationNotes === 'string' ? existing.moderationNotes : '',
      moderatedById: existing.moderatedById || null,
      moderatedByUsername: existing.moderatedByUsername || null,
      moderatedAt: existing.moderatedAt || null,

      approvalMessageId: existing.approvalMessageId || null,
      approvalChannelId: existing.approvalChannelId || null,
      approvalRequestedAt: existing.approvalRequestedAt || null,
      approvalExpiresAt: existing.approvalExpiresAt || null,
      lastApprovalTriggerX: Number(existing.lastApprovalTriggerX || 0),
      approvalMilestonesTriggered: Array.isArray(existing.approvalMilestonesTriggered)
        ? existing.approvalMilestonesTriggered
        : [],

      xApproved: existing.xApproved === true,
      xPostedMilestones: Array.isArray(existing.xPostedMilestones)
        ? existing.xPostedMilestones
        : [],
      lastPostedX: Number(existing.lastPostedX || 0),
      xOriginalPostId: existing.xOriginalPostId || null,
      xLastReplyPostId: existing.xLastReplyPostId || null,
      xLastPostedAt: existing.xLastPostedAt || null
    });

    calls[existingIndex] = refreshPublicCallerName(updated);
    saveTrackedCalls(calls);
    return calls[existingIndex];
  }

  const trackedCallData = normalizeTrackedCall({
    tokenName: scan.tokenName,
    ticker: scan.ticker,
    contractAddress: scan.contractAddress,
    firstCalledMarketCap: scan.marketCap,
    latestMarketCap: scan.marketCap,
    entryScore: scan.entryScore,
    grade: scan.grade,
    alertType: scan.alertType,

    ...(callSourceType === 'watch_only'
      ? {
          firstCallerId: null,
          firstCallerUsername: null,
          firstCallerDiscordId: null,
          firstCallerDisplayName: null,
          firstCallerPublicName: null
        }
      : callerFields),

    firstCalledAt: now,
    lastUpdatedAt: now,
    milestonesHit: [],
    dumpAlertsHit: [],
    lifecycleStatus: 'active',
    isActive: true,
    athMc: Number(scan.marketCap || 0),
    discordMessageId: null,

    priceHistory:
      scan.marketCap != null && Number(scan.marketCap) > 0
        ? [{ t: Date.now(), price: Number(scan.marketCap) }]
        : [],

    callSourceType,
    wasWatched,

    approvalStatus: 'none',
    excludedFromStats: false,
    moderationTags: [],
    moderationNotes: '',
    moderatedById: null,
    moderatedByUsername: null,
    moderatedAt: null,

    approvalMessageId: null,
    approvalChannelId: null,
    approvalRequestedAt: null,
    approvalExpiresAt: null,
    lastApprovalTriggerX: 0,
    approvalMilestonesTriggered: [],

    xApproved: false,
    xPostedMilestones: [],
    lastPostedX: 0,
    xOriginalPostId: null,
    xLastReplyPostId: null,
    xLastPostedAt: null
  });

  calls.push(refreshPublicCallerName(trackedCallData));
  saveTrackedCalls(calls);
  return calls[calls.length - 1];
}

function reactivateTrackedCall(
  scan,
  callerId = null,
  callerUsername = 'Unknown',
  callerDisplayName = '',
  options = {}
) {
  const calls = loadTrackedCalls();
  const existingIndex = calls.findIndex(call => call.contractAddress === scan.contractAddress);

  if (existingIndex === -1) {
    return saveTrackedCall(scan, callerId, callerUsername, callerDisplayName, options);
  }

  const existing = normalizeTrackedCall(calls[existingIndex]);
  const now = new Date().toISOString();

  const updated = normalizeTrackedCall({
    ...existing,
    tokenName: scan.tokenName || existing.tokenName,
    ticker: scan.ticker || existing.ticker,
    contractAddress: scan.contractAddress || existing.contractAddress,
    latestMarketCap: scan.marketCap ?? existing.latestMarketCap,
    entryScore: scan.entryScore ?? existing.entryScore,
    grade: scan.grade ?? existing.grade,
    alertType: scan.alertType ?? existing.alertType,
    lastUpdatedAt: now,
    lifecycleStatus: 'active',
    isActive: true,
    athMc: Math.max(
      Number(existing.athMc || existing.latestMarketCap || existing.firstCalledMarketCap || 0),
      Number(scan.marketCap || 0)
    ),
    priceHistory: (() => {
      const prev = Array.isArray(existing.priceHistory) ? [...existing.priceHistory] : [];
      const mc = Number(scan.marketCap ?? existing.latestMarketCap ?? 0);
      if (mc <= 0) return prev;
      prev.push({ t: Date.now(), price: mc });
      return prev.slice(-500);
    })()
  });

  calls[existingIndex] = refreshPublicCallerName(updated);
  saveTrackedCalls(calls);
  return calls[existingIndex];
}

/**
 * =========================
 * UPDATE HELPERS
 * =========================
 */

function updateTrackedCallData(contractAddress, updates = {}) {
  const calls = loadTrackedCalls();
  const index = calls.findIndex(call => call.contractAddress === contractAddress);

  if (index === -1) return null;

  const existing = normalizeTrackedCall(calls[index]);

  const updated = normalizeTrackedCall({
    ...existing,
    ...updates,
    contractAddress: existing.contractAddress,
    lastUpdatedAt: new Date().toISOString(),
    athMc: Math.max(
      Number(existing.athMc || existing.latestMarketCap || existing.firstCalledMarketCap || 0),
      Number(updates.latestMarketCap ?? updates.marketCap ?? existing.latestMarketCap ?? 0),
      Number(updates.athMc ?? updates.ath ?? existing.athMc ?? 0)
    )
  });

  calls[index] = refreshPublicCallerName(updated);
  saveTrackedCalls(calls);
  return calls[index];
}

function markMilestoneHit(contractAddress, milestoneKey) {
  const tracked = getTrackedCall(contractAddress);
  if (!tracked || !milestoneKey) return null;

  const milestonesHit = Array.isArray(tracked.milestonesHit)
    ? [...new Set([...tracked.milestonesHit, milestoneKey])]
    : [milestoneKey];

  return updateTrackedCallData(contractAddress, { milestonesHit });
}

function markDumpAlertHit(contractAddress, dumpKey) {
  const tracked = getTrackedCall(contractAddress);
  if (!tracked || !dumpKey) return null;

  const dumpAlertsHit = Array.isArray(tracked.dumpAlertsHit)
    ? [...new Set([...tracked.dumpAlertsHit, dumpKey])]
    : [dumpKey];

  return updateTrackedCallData(contractAddress, { dumpAlertsHit });
}

function setLifecycleStatus(contractAddress, lifecycleStatus, isActive = true) {
  return updateTrackedCallData(contractAddress, {
    lifecycleStatus,
    isActive
  });
}

function addModerationTag(contractAddress, tag, moderator = {}) {
  const tracked = getTrackedCall(contractAddress);
  if (!tracked || !tag) return null;

  const cleanTag = String(tag).trim().toLowerCase();
  if (!cleanTag) return null;

  const moderationTags = Array.isArray(tracked.moderationTags)
    ? [...new Set([...tracked.moderationTags, cleanTag])]
    : [cleanTag];

  return updateTrackedCallData(contractAddress, {
    moderationTags,
    moderatedById: moderator.id || tracked.moderatedById || null,
    moderatedByUsername: moderator.username || tracked.moderatedByUsername || null,
    moderatedAt: new Date().toISOString()
  });
}

function setModerationNotes(contractAddress, note, moderator = {}) {
  const tracked = getTrackedCall(contractAddress);
  if (!tracked) return null;

  return updateTrackedCallData(contractAddress, {
    moderationNotes: String(note || '').trim(),
    moderatedById: moderator.id || tracked.moderatedById || null,
    moderatedByUsername: moderator.username || tracked.moderatedByUsername || null,
    moderatedAt: new Date().toISOString()
  });
}

/**
 * =========================
 * APPROVAL HELPERS
 * =========================
 */

function markApprovalRequested(contractAddress, triggerX = 0, expiresAt = null) {
  const tracked = getTrackedCall(contractAddress);
  if (!tracked) return null;

  const triggered = Array.isArray(tracked.approvalMilestonesTriggered)
    ? [...new Set([...tracked.approvalMilestonesTriggered, Number(triggerX || 0)])]
    : [Number(triggerX || 0)];

  return updateTrackedCallData(contractAddress, {
    approvalStatus: 'pending',
    approvalRequestedAt: new Date().toISOString(),
    approvalExpiresAt: expiresAt || null,
    lastApprovalTriggerX: Number(triggerX || 0),
    approvalMilestonesTriggered: triggered
  });
}

function setApprovalMessageMeta(contractAddress, approvalMessageId = null, approvalChannelId = null) {
  return updateTrackedCallData(contractAddress, {
    approvalMessageId: approvalMessageId || null,
    approvalChannelId: approvalChannelId || null
  });
}

function clearApprovalRequest(contractAddress) {
  return updateTrackedCallData(contractAddress, {
    approvalMessageId: null,
    approvalChannelId: null,
    approvalRequestedAt: null,
    approvalExpiresAt: null
  });
}

function setApprovalStatus(
  contractAddress,
  status = 'pending',
  moderation = {}
) {
  const tracked = getTrackedCall(contractAddress);
  if (!tracked) return null;

  const excludedFromStats =
    status === 'excluded' || moderation.excludedFromStats === true;

  const moderationTags = Object.prototype.hasOwnProperty.call(moderation, 'moderationTags')
    ? (Array.isArray(moderation.moderationTags) ? moderation.moderationTags : [])
    : Array.isArray(tracked.moderationTags)
      ? tracked.moderationTags
      : [];

  const moderationNotes = Object.prototype.hasOwnProperty.call(moderation, 'moderationNotes')
    ? String(moderation.moderationNotes || '').trim()
    : typeof tracked.moderationNotes === 'string'
      ? tracked.moderationNotes
      : '';

  const moderatedById = Object.prototype.hasOwnProperty.call(moderation, 'moderatedById')
    ? moderation.moderatedById || null
    : tracked.moderatedById || null;

  const moderatedByUsername = Object.prototype.hasOwnProperty.call(
    moderation,
    'moderatedByUsername'
  )
    ? moderation.moderatedByUsername || null
    : tracked.moderatedByUsername || null;

  return updateTrackedCallData(contractAddress, {
    approvalStatus: status,
    excludedFromStats,
    moderationTags,
    moderationNotes,
    moderatedById,
    moderatedByUsername,
    moderatedAt: new Date().toISOString(),
    xApproved: status === 'approved'
  });
}

/**
 * =========================
 * X POST HELPERS
 * =========================
 */

function setXPostState(contractAddress, updates = {}) {
  return updateTrackedCallData(contractAddress, {
    xApproved: updates.xApproved ?? undefined,
    xPostedMilestones: Array.isArray(updates.xPostedMilestones)
      ? updates.xPostedMilestones
      : undefined,
    xOriginalPostId: updates.xOriginalPostId ?? undefined,
    xLastReplyPostId: updates.xLastReplyPostId ?? undefined,
    xLastPostedAt: updates.xLastPostedAt ?? undefined
  });
}
/**
 * =========================
 * STATS RESET HELPERS
 * =========================
 */

function excludeTrackedCallsFromStatsByCaller(
  callerLookup = {},
  resetMeta = {}
) {
  const calls = loadTrackedCalls();

  let updatedCount = 0;

  const updatedCalls = calls.map(call => {
    if (!call || call.callSourceType !== 'user_call') return call;

    const callDiscordId = String(call.firstCallerDiscordId || call.firstCallerId || '');
    const callUsername = String(call.firstCallerUsername || '').toLowerCase().trim();
    const callDisplayName = String(call.firstCallerDisplayName || '').toLowerCase().trim();

    const lookupDiscordId = String(callerLookup.discordUserId || '').trim();
    const lookupUsername = String(callerLookup.username || '').toLowerCase().trim();
    const lookupDisplayName = String(callerLookup.displayName || '').toLowerCase().trim();

    const matches =
      (lookupDiscordId && callDiscordId && lookupDiscordId === callDiscordId) ||
      (lookupUsername && callUsername && lookupUsername === callUsername) ||
      (lookupDisplayName && callDisplayName && lookupDisplayName === callDisplayName);

    if (!matches) return call;

    updatedCount += 1;

    const resetHistory = Array.isArray(call.statsResetHistory)
      ? [...call.statsResetHistory]
      : [];

    resetHistory.push({
      resetAt: new Date().toISOString(),
      resetById: resetMeta.resetById || null,
      resetByUsername: resetMeta.resetByUsername || null,
      resetReason: resetMeta.resetReason || 'Manual reset'
    });

    return normalizeTrackedCall({
      ...call,
      excludedFromStats: true,
      statsResetAt: new Date().toISOString(),
      statsResetById: resetMeta.resetById || null,
      statsResetByUsername: resetMeta.resetByUsername || null,
      statsResetReason: resetMeta.resetReason || 'Manual reset',
      statsResetHistory: resetHistory
    });
  });

  saveTrackedCalls(updatedCalls);

  return {
    success: true,
    updatedCount
  };
}

function excludeTrackedBotCallsFromStats(resetMeta = {}) {
  const calls = loadTrackedCalls();

  let updatedCount = 0;

  const updatedCalls = calls.map(call => {
    if (!call || call.callSourceType !== 'bot_call') return call;

    updatedCount += 1;

    const resetHistory = Array.isArray(call.statsResetHistory)
      ? [...call.statsResetHistory]
      : [];

    resetHistory.push({
      resetAt: new Date().toISOString(),
      resetById: resetMeta.resetById || null,
      resetByUsername: resetMeta.resetByUsername || null,
      resetReason: resetMeta.resetReason || 'Manual bot reset'
    });

    return normalizeTrackedCall({
      ...call,
      excludedFromStats: true,
      statsResetAt: new Date().toISOString(),
      statsResetById: resetMeta.resetById || null,
      statsResetByUsername: resetMeta.resetByUsername || null,
      statsResetReason: resetMeta.resetReason || 'Manual bot reset',
      statsResetHistory: resetHistory
    });
  });

  saveTrackedCalls(updatedCalls);

  return {
    success: true,
    updatedCount
  };
}

/**
 * =========================
 * EXPORTS
 * =========================
 */

module.exports = {
  loadTrackedCalls,
  saveTrackedCalls,
  getTrackedCall,
  getAllTrackedCalls,
  getRecentBotCalls,
  getApprovalStats,
  getPendingApprovals,
  saveTrackedCall,
  reactivateTrackedCall,
  updateTrackedCallData,
  markMilestoneHit,
  markDumpAlertHit,
  setLifecycleStatus,
  addModerationTag,
  setModerationNotes,

  markApprovalRequested,
  setApprovalMessageMeta,
  clearApprovalRequest,
  setApprovalStatus,

  setXPostState,

  excludeTrackedCallsFromStatsByCaller,
  excludeTrackedBotCallsFromStats,
  resetAllTrackedCalls,
};