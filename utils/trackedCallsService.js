const fs = require('fs');
const path = require('path');
const { upsertUserProfile } = require('../utils/userProfileService');

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

function normalizeTrackedCall(call = {}) {
  return {
    ...call,

    milestonesHit: Array.isArray(call.milestonesHit) ? call.milestonesHit : [],
    dumpAlertsHit: Array.isArray(call.dumpAlertsHit) ? call.dumpAlertsHit : [],
    lifecycleStatus: call.lifecycleStatus || 'active',
    isActive: call.isActive !== false,

    callSourceType: call.callSourceType || 'user_call', // user_call | watch_only | bot_call
    wasWatched: call.wasWatched === true,

    approvalStatus: call.approvalStatus || 'pending',
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
    xOriginalPostId: call.xOriginalPostId || null,
    xLastReplyPostId: call.xLastReplyPostId || null,
    xLastPostedAt: call.xLastPostedAt || null
  };
}

function getTrackedCall(contractAddress) {
  const calls = loadTrackedCalls();
  return calls.find(call => call.contractAddress === contractAddress) || null;
}

function getAllTrackedCalls() {
  return loadTrackedCalls();
}

function syncCallerProfile(callerId = null, callerUsername = 'Unknown', callerDisplayName = '') {
  try {
    if (!callerId && !callerUsername && !callerDisplayName) return null;

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

function buildCallerFields(callerId = null, callerUsername = 'Unknown', callerDisplayName = '') {
  const syncedProfile = syncCallerProfile(callerId, callerUsername, callerDisplayName);

  return {
    firstCallerId: callerId ? String(callerId) : null,
    firstCallerUsername: callerUsername || 'Unknown',
    firstCallerDiscordId: callerId ? String(callerId) : null,
    firstCallerDisplayName: callerDisplayName || callerUsername || 'Unknown',
    firstCallerPublicName: syncedProfile
      ? (
          syncedProfile.publicSettings?.publicAlias ||
          syncedProfile.displayName ||
          syncedProfile.username ||
          callerDisplayName ||
          callerUsername ||
          'Unknown'
        )
      : (callerDisplayName || callerUsername || 'Unknown')
  };
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

  const callerFields = buildCallerFields(callerId, callerUsername, callerDisplayName);

  const callSourceType =
    options.callSourceType === 'watch_only'
      ? 'watch_only'
      : options.callSourceType === 'bot_call'
        ? 'bot_call'
        : 'user_call';

  const wasWatched = callSourceType === 'watch_only';

  if (existingIndex !== -1) {
    const existing = normalizeTrackedCall(calls[existingIndex]);

    const shouldUpgradeWatchToCall =
      existing.callSourceType === 'watch_only' && callSourceType === 'user_call';

    calls[existingIndex] = normalizeTrackedCall({
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

      discordMessageId: existing.discordMessageId || null,

      firstCallerId:
        shouldUpgradeWatchToCall
          ? callerFields.firstCallerId
          : (existing.firstCallerId || (callSourceType === 'user_call' ? callerFields.firstCallerId : null)),

      firstCallerUsername:
        shouldUpgradeWatchToCall
          ? callerFields.firstCallerUsername
          : (existing.firstCallerUsername || (callSourceType === 'user_call' ? callerFields.firstCallerUsername : null)),

      firstCallerDiscordId:
        shouldUpgradeWatchToCall
          ? callerFields.firstCallerDiscordId
          : (existing.firstCallerDiscordId || (callSourceType === 'user_call' ? callerFields.firstCallerDiscordId : null)),

      firstCallerDisplayName:
        shouldUpgradeWatchToCall
          ? callerFields.firstCallerDisplayName
          : (existing.firstCallerDisplayName || (callSourceType === 'user_call' ? callerFields.firstCallerDisplayName : null)),

      firstCallerPublicName:
        shouldUpgradeWatchToCall
          ? callerFields.firstCallerPublicName
          : (existing.firstCallerPublicName || (callSourceType === 'user_call' ? callerFields.firstCallerPublicName : null)),

      firstCalledAt:
        shouldUpgradeWatchToCall
          ? now
          : (existing.firstCalledAt || now),

      firstCalledMarketCap:
        shouldUpgradeWatchToCall
          ? (scan.marketCap ?? existing.firstCalledMarketCap)
          : (existing.firstCalledMarketCap ?? scan.marketCap),

      callSourceType: shouldUpgradeWatchToCall ? 'user_call' : (existing.callSourceType || callSourceType),
      wasWatched: existing.wasWatched === true || wasWatched === true,

      approvalStatus: existing.approvalStatus || 'pending',
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
      xOriginalPostId: existing.xOriginalPostId || null,
      xLastReplyPostId: existing.xLastReplyPostId || null,
      xLastPostedAt: existing.xLastPostedAt || null
    });

    saveTrackedCalls(calls);
    return calls[existingIndex];
  }

  const trackedCallData = normalizeTrackedCall({
    tokenName: scan.tokenName,
    ticker: scan.ticker,
    contractAddress: scan.contractAddress,
    firstCalledMarketCap: callSourceType === 'user_call' ? scan.marketCap : scan.marketCap,
    latestMarketCap: scan.marketCap,
    entryScore: scan.entryScore,
    grade: scan.grade,
    alertType: scan.alertType,

    ...(callSourceType === 'user_call'
      ? callerFields
      : {
          firstCallerId: null,
          firstCallerUsername: null,
          firstCallerDiscordId: null,
          firstCallerDisplayName: null,
          firstCallerPublicName: null
        }),

    firstCalledAt: now,
    lastUpdatedAt: now,
    milestonesHit: [],
    dumpAlertsHit: [],
    lifecycleStatus: 'active',
    isActive: true,
    athMc: Number(scan.marketCap || 0),
    discordMessageId: null,

    callSourceType,
    wasWatched,

    approvalStatus: 'pending',
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
    xOriginalPostId: null,
    xLastReplyPostId: null,
    xLastPostedAt: null
  });

  calls.push(trackedCallData);
  saveTrackedCalls(calls);
  return trackedCallData;
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

  calls[existingIndex] = normalizeTrackedCall({
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
    )
  });

  saveTrackedCalls(calls);
  return calls[existingIndex];
}

function updateTrackedCallData(contractAddress, updates = {}) {
  const calls = loadTrackedCalls();
  const existingIndex = calls.findIndex(call => call.contractAddress === contractAddress);

  if (existingIndex === -1) return null;

  const existing = normalizeTrackedCall(calls[existingIndex]);

  const blockedOwnershipFields = new Set([
    'firstCallerId',
    'firstCallerUsername',
    'firstCallerDiscordId',
    'firstCallerDisplayName',
    'firstCallerPublicName',
    'firstCalledAt',
    'firstCalledMarketCap',
    'callSourceType',
    'wasWatched'
  ]);

  const safeUpdates = { ...updates };

  for (const key of blockedOwnershipFields) {
    delete safeUpdates[key];
  }

  calls[existingIndex] = normalizeTrackedCall({
    ...existing,
    ...safeUpdates,
    lastUpdatedAt: new Date().toISOString()
  });

  saveTrackedCalls(calls);
  return calls[existingIndex];
}

function setApprovalStatus(contractAddress, status, moderator = {}) {
  const allowed = new Set(['pending', 'approved', 'denied', 'excluded', 'expired']);
  if (!allowed.has(status)) return null;

  const updates = {
    approvalStatus: status,
    excludedFromStats: status === 'excluded',
    moderatedById: moderator.id ? String(moderator.id) : null,
    moderatedByUsername: moderator.username || null,
    moderatedAt: new Date().toISOString()
  };

  if (status === 'approved') {
    updates.xApproved = true;
  }

  return updateTrackedCallData(contractAddress, updates);
}

function excludeTrackedCall(contractAddress, moderator = {}) {
  return setApprovalStatus(contractAddress, 'excluded', moderator);
}

function includeTrackedCall(contractAddress, moderator = {}) {
  return updateTrackedCallData(contractAddress, {
    approvalStatus: 'pending',
    excludedFromStats: false,
    moderatedById: moderator.id ? String(moderator.id) : null,
    moderatedByUsername: moderator.username || null,
    moderatedAt: new Date().toISOString()
  });
}

function addModerationTag(contractAddress, tag, moderator = {}) {
  const trackedCall = getTrackedCall(contractAddress);
  if (!trackedCall || !tag) return null;

  const cleanTag = String(tag).trim().toLowerCase();
  if (!cleanTag) return null;

  const existingTags = Array.isArray(trackedCall.moderationTags)
    ? trackedCall.moderationTags
    : [];

  const nextTags = [...new Set([...existingTags, cleanTag])];

  return updateTrackedCallData(contractAddress, {
    moderationTags: nextTags,
    moderatedById: moderator.id ? String(moderator.id) : null,
    moderatedByUsername: moderator.username || null,
    moderatedAt: new Date().toISOString()
  });
}

function removeModerationTag(contractAddress, tag, moderator = {}) {
  const trackedCall = getTrackedCall(contractAddress);
  if (!trackedCall || !tag) return null;

  const cleanTag = String(tag).trim().toLowerCase();
  if (!cleanTag) return null;

  const existingTags = Array.isArray(trackedCall.moderationTags)
    ? trackedCall.moderationTags
    : [];

  const nextTags = existingTags.filter(t => t !== cleanTag);

  return updateTrackedCallData(contractAddress, {
    moderationTags: nextTags,
    moderatedById: moderator.id ? String(moderator.id) : null,
    moderatedByUsername: moderator.username || null,
    moderatedAt: new Date().toISOString()
  });
}

function setModerationNotes(contractAddress, notes, moderator = {}) {
  return updateTrackedCallData(contractAddress, {
    moderationNotes: String(notes || '').trim(),
    moderatedById: moderator.id ? String(moderator.id) : null,
    moderatedByUsername: moderator.username || null,
    moderatedAt: new Date().toISOString()
  });
}

function setApprovalMessageMeta(contractAddress, approvalMessageId = null, approvalChannelId = null) {
  return updateTrackedCallData(contractAddress, {
    approvalMessageId: approvalMessageId ? String(approvalMessageId) : null,
    approvalChannelId: approvalChannelId ? String(approvalChannelId) : null
  });
}

function markApprovalRequested(contractAddress, triggerX, expiresAtIso) {
  const trackedCall = getTrackedCall(contractAddress);
  if (!trackedCall) return null;

  const existingMilestones = Array.isArray(trackedCall.approvalMilestonesTriggered)
    ? trackedCall.approvalMilestonesTriggered
    : [];

  const nextMilestones = [...new Set([...existingMilestones, Number(triggerX)])];

  return updateTrackedCallData(contractAddress, {
    approvalStatus: 'pending',
    approvalRequestedAt: new Date().toISOString(),
    approvalExpiresAt: expiresAtIso,
    lastApprovalTriggerX: Number(triggerX || 0),
    approvalMilestonesTriggered: nextMilestones
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

function setXPostState(contractAddress, updates = {}) {
  return updateTrackedCallData(contractAddress, {
    ...updates
  });
}

module.exports = {
  loadTrackedCalls,
  saveTrackedCalls,
  normalizeTrackedCall,
  getTrackedCall,
  getAllTrackedCalls,
  saveTrackedCall,
  reactivateTrackedCall,
  updateTrackedCallData,

  setApprovalStatus,
  excludeTrackedCall,
  includeTrackedCall,
  addModerationTag,
  removeModerationTag,
  setModerationNotes,
  setApprovalMessageMeta,
  markApprovalRequested,
  clearApprovalRequest,

  setXPostState
};