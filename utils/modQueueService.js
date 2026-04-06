const { getPendingApprovals } = require('./trackedCallsService');
const { getPendingXVerifications, getAllUserProfiles, getCallerTrustLevel } = require('./userProfileService');
const { getTopCallerEligibilityReport } = require('./callerStatsService');

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function minutesSince(isoTime) {
  if (!isoTime) return null;
  const t = new Date(isoTime).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

function minutesUntil(isoTime) {
  if (!isoTime) return null;
  const t = new Date(isoTime).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - Date.now()) / 60000);
}

function pickDisplayName(profile = {}, fallback = 'Unknown') {
  return (
    profile.preferredPublicName ||
    profile.discordDisplayName ||
    profile.displayName ||
    profile.username ||
    profile.discordUsername ||
    fallback
  );
}

function normalizeRequestedHandle(profile = {}) {
  const raw = profile?.xVerification?.requestedHandle || '';
  const h = String(raw || '').trim().replace(/^@+/, '');
  return h ? `@${h}` : '';
}

function buildCoinApprovalItem(call) {
  const entryMc = safeNumber(call.firstCalledMarketCap || call.marketCapAtCall || call.marketCap || 0);
  const currentMc = safeNumber(call.latestMarketCap || call.currentMarketCap || call.marketCap || 0);
  const mult = entryMc > 0 ? currentMc / entryMc : 0;

  return {
    contractAddress: call.contractAddress || '',
    tokenName: call.tokenName || 'Unknown',
    ticker: call.ticker || '',
    callSourceType: call.callSourceType || 'user_call',
    approvalStatus: String(call.approvalStatus || 'none').toLowerCase(),
    approvalRequestedAt: call.approvalRequestedAt || null,
    approvalExpiresAt: call.approvalExpiresAt || null,
    minutesSinceRequested: minutesSince(call.approvalRequestedAt),
    minutesUntilExpiry: minutesUntil(call.approvalExpiresAt),
    isActive: call.isActive !== false,
    lifecycleStatus: String(call.lifecycleStatus || 'active').toLowerCase(),
    entryMarketCap: entryMc,
    currentMarketCap: currentMc,
    priority: {
      currentOverEntryX: mult
    }
  };
}

function buildXVerificationItem(profile) {
  return {
    discordUserId: profile.discordUserId ? String(profile.discordUserId) : null,
    displayName: pickDisplayName(profile),
    status: String(profile?.xVerification?.status || 'none').toLowerCase(),
    requestedHandle: normalizeRequestedHandle(profile),
    requestedAt: profile?.xVerification?.requestedAt || null,
    minutesSinceRequested: minutesSince(profile?.xVerification?.requestedAt)
  };
}

function buildTopCallerCandidateItem(profile, report) {
  const trust = getCallerTrustLevel(profile.discordUserId);
  const bestX = Number(report?.bestX || 0);
  const avgX = Number(report?.avgX || 0);

  return {
    discordUserId: profile.discordUserId ? String(profile.discordUserId) : null,
    displayName: pickDisplayName(profile),
    currentTrust: trust,
    validCallCount: report?.validCallCount ?? 0,
    avgX,
    bestX,
    bestToken: report?.bestToken || '',
    eligibility: report?.eligibility || 'UNKNOWN'
  };
}

function parseIsoMs(value) {
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Read-only aggregator for “what mods should look at right now”.
 * Future categories can plug into this without re-stitching command handlers.
 */
function getModQueuesSnapshot(options = {}) {
  const {
    xLimit = 8,
    coinLimit = 50,
    topBotLimit = 8,
    includeArchived = false,
    topCallerLimit = 10
  } = options;

  const pendingXProfiles = getPendingXVerifications(xLimit) || [];
  const xItems = pendingXProfiles.map(buildXVerificationItem);

  const pendingCoins = getPendingApprovals(coinLimit) || [];
  const coinItems = pendingCoins
    .filter(c => {
      if (!c) return false;
      if (!includeArchived && String(c.lifecycleStatus || 'active').toLowerCase() === 'archived') {
        return false;
      }
      return c.isActive !== false;
    })
    .map(buildCoinApprovalItem);

  const topPendingBot = coinItems
    .filter(i => i.callSourceType === 'bot_call' && i.approvalStatus === 'pending')
    .sort((a, b) => (b.priority.currentOverEntryX || 0) - (a.priority.currentOverEntryX || 0))
    .slice(0, topBotLimit);

  // Top Caller candidates (read-only): eligible YES, not already top_caller/trusted_pro/restricted,
  // and not currently dismissed.
  const profiles = getAllUserProfiles();
  const now = Date.now();

  const topCallerCandidates = profiles
    .filter(p => p && p.discordUserId)
    .filter(p => {
      const trust = getCallerTrustLevel(p.discordUserId);
      if (trust === 'top_caller' || trust === 'trusted_pro' || trust === 'restricted') return false;

      const dismissedUntil = p?.topCallerReview?.dismissedUntil;
      if (dismissedUntil && parseIsoMs(dismissedUntil) > now) return false;

      // If already posted as a review message somewhere, keep it out of “new items” lists.
      // (Channel sync handles “existing message missing” recovery.)
      return true;
    })
    .map(p => {
      const report = getTopCallerEligibilityReport(String(p.discordUserId));
      return { p, report };
    })
    .filter(({ report }) => report && report.eligibility === 'YES')
    // Prefer higher avgX then sample size for priority; keep stable ordering
    .sort((a, b) => {
      const ax = Number(a.report.avgX || 0);
      const bx = Number(b.report.avgX || 0);
      if (bx !== ax) return bx - ax;
      return Number(b.report.validCallCount || 0) - Number(a.report.validCallCount || 0);
    })
    .slice(0, topCallerLimit)
    .map(({ p, report }) => buildTopCallerCandidateItem(p, report));

  return {
    generatedAt: new Date().toISOString(),
    queues: {
      xVerifications: {
        kind: 'x_verification',
        items: xItems
      },
      coinApprovals: {
        kind: 'coin_approval',
        items: coinItems,
        topPendingBotByPriority: topPendingBot
      },
      topCallerCandidates: {
        kind: 'top_caller_candidate',
        items: topCallerCandidates
      }
    }
  };
}

module.exports = {
  getModQueuesSnapshot
};

