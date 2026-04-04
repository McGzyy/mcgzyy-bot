/**
 * X mention → tracked call intake (plumbing only).
 * No live polling/streaming and no X API replies here — call processVerifiedXMentionCallIntake from a future worker or test harness.
 *
 * After intake, use decideXMentionIntakeReply(result, { authorHandle }) from ./xIntakeReplyPolicy
 * (re-exported below) when wiring createPost to ingestion.
 */

const { getXVerifiedTrustStatus } = require('./xInteractionTrust');
const {
  X_INTAKE_NOT_IN_GUILD_MESSAGE,
  validateXIntakeGuildTrust
} = require('./xIntakeGuildTrust');
const {
  applyTrackedCallState,
  runQuickCa,
  normalizeRealDataToScan,
  isLikelySolanaCA
} = require('../commands/basicCommands');
const {
  isXIntakeTweetProcessed,
  markXIntakeTweetProcessed,
  normalizeTweetDedupeId
} = require('./xIntakeDedupeService');
const {
  decideXMentionIntakeReply,
  buildXMentionSuccessReplyText
} = require('./xIntakeReplyPolicy');

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
 * Trust: (1) getXVerifiedTrustStatus(authorHandle) — mod-verified X ↔ Discord profile.
 *        (2) validateXIntakeGuildTrust — linked user must be in the configured Discord server (unless skipGuildMembershipCheck).
 *
 * Pass options.guild (e.g. message.guild) and/or options.client + DISCORD_GUILD_ID / X_INTAKE_GUILD_ID, or rely on a single cached guild.
 *
 * Dedupe: pass `tweetId` (or `eventId`) on payload or options. If set, already-processed IDs short-circuit before intake.
 * Successful **tracked** applies (not dry-run) record the id. Omit id to skip dedupe (e.g. tests).
 *
 * @param {{ authorHandle: string, tweetText: string, tweetId?: string, eventId?: string }} payload
 * @param {{
 *   dryRun?: boolean,
 *   skipTokenFetch?: boolean,
 *   client?: import('discord.js').Client,
 *   guild?: import('discord.js').Guild,
 *   skipGuildMembershipCheck?: boolean,
 *   requiredRoleIds?: string[],
 *   tweetId?: string,
 *   eventId?: string,
 *   skipDedupeCheck?: boolean
 * }} [options]
 * @returns {Promise<object>}
 */
async function processVerifiedXMentionCallIntake(payload, options = {}) {
  const { authorHandle, tweetText } = payload || {};
  const {
    dryRun = false,
    skipTokenFetch = false,
    client = null,
    guild = null,
    skipGuildMembershipCheck = false,
    requiredRoleIds = null,
    skipDedupeCheck = false
  } = options;

  const dedupeId = normalizeTweetDedupeId(
    payload?.tweetId ||
      payload?.eventId ||
      options.tweetId ||
      options.eventId ||
      ''
  );

  if (!skipDedupeCheck && dedupeId && isXIntakeTweetProcessed(dedupeId)) {
    return {
      success: false,
      duplicate: true,
      alreadyProcessed: true,
      reason: 'already_processed',
      tweetId: dedupeId,
      trust: null,
      guildTrust: null,
      contractAddress: null,
      callerContext: null
    };
  }

  const trust = getXVerifiedTrustStatus(authorHandle);
  if (!trust.allowed) {
    return {
      success: false,
      trustDenied: true,
      reason: trust.reason,
      replyMessage: trust.replyMessage,
      trust,
      guildTrust: null,
      contractAddress: null,
      callerContext: null
    };
  }

  const discordUserIdForGuild = trust.discordUserId || trust.profile?.discordUserId || null;
  if (!str(discordUserIdForGuild)) {
    return {
      success: false,
      reason: 'missing_discord_user_id_for_guild_check',
      trust,
      guildTrust: null,
      contractAddress: null,
      callerContext: null
    };
  }

  let guildTrust = null;
  if (!skipGuildMembershipCheck) {
    guildTrust = await validateXIntakeGuildTrust({
      client,
      guild,
      discordUserId: discordUserIdForGuild,
      requiredRoleIds
    });

    if (!guildTrust.ok) {
      const replyMessage =
        guildTrust.reason === 'not_in_guild'
          ? X_INTAKE_NOT_IN_GUILD_MESSAGE
          : null;

      return {
        success: false,
        trustDenied: false,
        guildTrustDenied: true,
        reason: guildTrust.reason,
        replyMessage,
        trust,
        guildTrust,
        contractAddress: null,
        callerContext: null
      };
    }
  }

  const ca = extractFirstSolanaCaFromText(tweetText);
  if (!ca) {
    return {
      success: false,
      reason: 'no_solana_ca_in_text',
      trust,
      guildTrust,
      contractAddress: null,
      callerContext: null
    };
  }

  if (!isLikelySolanaCA(ca)) {
    return {
      success: false,
      reason: 'invalid_solana_ca',
      trust,
      guildTrust,
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
      guildTrust,
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
      guildTrust,
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
      guildTrust,
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
      guildTrust,
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

  if (!skipDedupeCheck && dedupeId) {
    markXIntakeTweetProcessed(dedupeId);
  }

  return {
    success: true,
    reason: 'tracked',
    tweetId: dedupeId || undefined,
    trust,
    guildTrust,
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
  processVerifiedXMentionCallIntake,
  decideXMentionIntakeReply,
  buildXMentionSuccessReplyText
};
