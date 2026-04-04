/**
 * X mention → tracked call intake (plumbing only).
 * No live polling/streaming and no X API replies here — call processVerifiedXMentionCallIntake from a future worker or test harness.
 */

const { getXVerifiedTrustStatus } = require('./xInteractionTrust');
const {
  applyTrackedCallState,
  runQuickCa,
  normalizeRealDataToScan,
  isLikelySolanaCA
} = require('../commands/basicCommands');

const X_CALL_INTAKE_SOURCE = 'x_mention';

function str(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * First Solana-looking contract in free text (same pattern as index.js extractSolanaAddress).
 * @param {string} text
 * @returns {string|null}
 */
function extractFirstSolanaCaFromText(text) {
  const match = String(text || '').match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
  return match ? match[0] : null;
}

/**
 * Caller context for applyTrackedCallState from a mod-verified user profile row.
 * @param {object} profile — from getXVerifiedTrustStatus / getUserProfileByVerifiedXHandle
 * @returns {{ discordUserId: string, username: string, displayName: string }|null}
 */
function buildCallerContextFromVerifiedProfile(profile) {
  if (!profile?.discordUserId) return null;

  const username = str(profile.username) || 'Unknown';
  const displayName =
    str(profile.discordDisplayName) ||
    str(profile.displayName) ||
    username;

  return {
    discordUserId: String(profile.discordUserId),
    username,
    displayName
  };
}

/**
 * End-to-end: verified X author + tweet body → optional tracked call (same pipeline as Discord !call).
 *
 * Trust: getXVerifiedTrustStatus(authorHandle) must return allowed (mod-linked verified handle in Discord).
 *
 * @param {{ authorHandle: string, tweetText: string }} payload
 * @param {{ dryRun?: boolean, skipTokenFetch?: boolean }} [options] — dryRun skips applyTrackedCallState; skipTokenFetch (with dryRun) skips Birdeye/token fetch
 * @returns {Promise<object>}
 */
async function processVerifiedXMentionCallIntake(payload, options = {}) {
  const { authorHandle, tweetText } = payload || {};
  const { dryRun = false, skipTokenFetch = false } = options;

  const trust = getXVerifiedTrustStatus(authorHandle);
  if (!trust.allowed) {
    return {
      success: false,
      trustDenied: true,
      reason: trust.reason,
      replyMessage: trust.replyMessage,
      trust,
      contractAddress: null,
      callerContext: null
    };
  }

  const ca = extractFirstSolanaCaFromText(tweetText);
  if (!ca) {
    return {
      success: false,
      reason: 'no_solana_ca_in_text',
      trust,
      contractAddress: null,
      callerContext: null
    };
  }

  if (!isLikelySolanaCA(ca)) {
    return {
      success: false,
      reason: 'invalid_solana_ca',
      trust,
      contractAddress: ca,
      callerContext: null
    };
  }

  const callerContext = buildCallerContextFromVerifiedProfile(trust.profile);
  if (!callerContext) {
    return {
      success: false,
      reason: 'missing_discord_user_on_profile',
      trust,
      contractAddress: ca,
      callerContext: null
    };
  }

  if (dryRun && skipTokenFetch) {
    return {
      success: true,
      dryRun: true,
      reason: 'dry_run_trust_and_ca_ok',
      trust,
      contractAddress: ca,
      callerContext
    };
  }

  let scan;
  try {
    const realData = await runQuickCa(ca);
    scan = normalizeRealDataToScan(realData);
  } catch (err) {
    return {
      success: false,
      reason: 'token_fetch_failed',
      error: err?.message || String(err),
      trust,
      contractAddress: ca,
      callerContext
    };
  }

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      reason: 'dry_run_full',
      trust,
      contractAddress: ca,
      callerContext,
      scanPreview: {
        tokenName: scan.tokenName,
        ticker: scan.ticker,
        marketCap: scan.marketCap
      }
    };
  }

  const applyResult = await applyTrackedCallState(
    ca,
    callerContext,
    scan.marketCap || 0,
    scan,
    { callSourceType: 'user_call', intakeSource: X_CALL_INTAKE_SOURCE }
  );

  return {
    success: true,
    reason: 'tracked',
    trust,
    contractAddress: ca,
    callerContext,
    intakeSource: X_CALL_INTAKE_SOURCE,
    trackedCall: applyResult.trackedCall,
    wasNewCall: applyResult.wasNewCall,
    wasReactivated: applyResult.wasReactivated
  };
}

module.exports = {
  X_CALL_INTAKE_SOURCE,
  extractFirstSolanaCaFromText,
  buildCallerContextFromVerifiedProfile,
  processVerifiedXMentionCallIntake
};
