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
const { isMilestoneChartAttachmentEnabled } = require('./tokenChartImage');
const {
  applyTrackedCallState,
  runQuickCa,
  normalizeRealDataToScan,
  isLikelySolanaCA,
  buildUserCallAnnouncementPayload,
  augmentNewUserCallPayloadWithChart,
  announceNewUserCallInUserCallsChannel,
  runDeferredUserCallChartEdits
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
const { getCallerTrustLevel } = require('./userProfileService');

const X_CALL_INTAKE_SOURCE = 'x_mention';

/**
 * Record tweet id after a live intake decision so polls after restart do not re-run the pipeline.
 * Skipped for dry-run and when skipDedupeCheck (tests / harness).
 */
function touchXMentionDedupe(dedupeId, skipDedupeCheck, dryRun) {
  if (skipDedupeCheck || !dedupeId || dryRun) return;
  markXIntakeTweetProcessed(dedupeId);
}

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
 * Hashtag labels only (no leading #), lowercased. Matches `#tag` where tag is [A-Za-z0-9_]+;
 * trailing punctuation (e.g. `#call.`) ends the tag at `.` — not plain words like "call" or "calling".
 * @param {string} text
 * @returns {Set<string>}
 */
function extractXMentionHashtagLabels(text) {
  const set = new Set();
  const s = String(text || '');
  const re = /#([a-zA-Z0-9_]+)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    set.add(m[1].toLowerCase());
  }
  return set;
}

/**
 * X intake only runs apply when `#call` is present (with verified user + valid CA). No default watch.
 */
function hasXMentionExplicitCallHashtag(tweetText) {
  return extractXMentionHashtagLabels(tweetText).has('call');
}

/** Trusted Pro intake mode hashtag. Takes precedence over #call when present. */
function hasXMentionExplicitProCallHashtag(tweetText) {
  return extractXMentionHashtagLabels(tweetText).has('procall');
}

function sanitizeProField(value, maxLen) {
  let s = String(value || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!s) return '';

  // Neutralize @mentions + strip URLs (avoid pinging or link spam in Discord).
  s = s.replace(/@\w+/g, '[mention]');
  s = s.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();

  if (!s) return '';

  if (s.length > maxLen) {
    s = `${s.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
  }

  return s;
}

function parseProCallFields(tweetText) {
  const lines = String(tweetText || '').split(/\r?\n/);
  let title = '';
  let why = '';
  let risk = '';

  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line) continue;

    const t = line.match(/^title\s*:\s*(.+)$/i);
    if (t && !title) {
      title = t[1];
      continue;
    }

    const w = line.match(/^why\s*:\s*(.+)$/i);
    if (w && !why) {
      why = w[1];
      continue;
    }

    const r = line.match(/^risk\s*:\s*(.+)$/i);
    if (r && !risk) {
      risk = r[1];
      continue;
    }
  }

  const out = {
    title: sanitizeProField(title, 80),
    why: sanitizeProField(why, 300),
    risk: sanitizeProField(risk, 120)
  };

  return out;
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
 * End-to-end: verified X author + tweet body → tracked **user_call** only when tweet includes `#call` (and valid CA).
 * Tweets without `#call` are ignored (no watch row, no Discord mirror, no reply); dedupe id is still recorded when present.
 *
 * Trust: (1) getXVerifiedTrustStatus(authorHandle) — mod-verified X ↔ Discord profile.
 *        (2) validateXIntakeGuildTrust — linked user must be in the configured Discord server (unless skipGuildMembershipCheck).
 *
 * Pass options.guild (e.g. message.guild) and/or options.client + DISCORD_GUILD_ID / X_INTAKE_GUILD_ID, or rely on a single cached guild.
 *
 * Dedupe: pass `tweetId` (or `eventId`) on payload or options. If set, already-processed IDs short-circuit before intake.
 * Live runs (not dry-run) persist the id to disk after **any** terminal outcome so restarts do not re-run intake.
 * Omit id or pass skipDedupeCheck to skip persistence (e.g. tests).
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
    touchXMentionDedupe(dedupeId, skipDedupeCheck, dryRun);
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
    touchXMentionDedupe(dedupeId, skipDedupeCheck, dryRun);
    return {
      success: false,
      reason: 'missing_discord_user_id_for_guild_check',
      trust,
      guildTrust: null,
      contractAddress: null,
      callerContext: null
    };
  }

  try {
    const uid = String(discordUserIdForGuild);
    const level = getCallerTrustLevel(uid);
    console.log(`[CallerTrust] user=${uid} level=${level} source=x_mention`);
  } catch (_) {}

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

      touchXMentionDedupe(dedupeId, skipDedupeCheck, dryRun);
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
    touchXMentionDedupe(dedupeId, skipDedupeCheck, dryRun);
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
    touchXMentionDedupe(dedupeId, skipDedupeCheck, dryRun);
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
    touchXMentionDedupe(dedupeId, skipDedupeCheck, dryRun);
    return {
      success: false,
      reason: 'missing_discord_user_on_profile',
      trust,
      guildTrust,
      contractAddress: ca,
      callerContext: null
    };
  }

  const hashtags = extractXMentionHashtagLabels(tweetText);
  const hasProCall = hashtags.has('procall');
  const hasCall = hashtags.has('call');

  // #procall takes precedence over #call when both are present.
  const requestedMode = hasProCall ? 'procall' : hasCall ? 'call' : 'none';

  // Pro call requires trusted_pro trust tier. Safest fallback:
  // - if #procall is present but user is not trusted_pro, only allow a normal #call if also present.
  // - otherwise ignore (no intake).
  if (requestedMode === 'procall') {
    const level = getCallerTrustLevel(String(callerContext.discordUserId || ''));
    if (level !== 'trusted_pro') {
      if (!hasCall) {
        touchXMentionDedupe(dedupeId, skipDedupeCheck, dryRun);
        return {
          success: false,
          reason: 'procall_requires_trusted_pro',
          trust,
          guildTrust,
          contractAddress: ca,
          callerContext
        };
      }
      // Fall back to regular #call behavior if both tags present.
    }
  }

  if (requestedMode === 'none') {
    touchXMentionDedupe(dedupeId, skipDedupeCheck, dryRun);
    return {
      success: false,
      reason: 'no_explicit_call_hashtag',
      trust,
      guildTrust,
      contractAddress: ca,
      callerContext
    };
  }

  const isProCallMode =
    requestedMode === 'procall' &&
    getCallerTrustLevel(String(callerContext.discordUserId || '')) === 'trusted_pro';

  const proFields = isProCallMode ? parseProCallFields(tweetText) : null;

  if (dryRun && skipTokenFetch) {
    return {
      success: true,
      dryRun: true,
      reason: 'dry_run_trust_and_ca_ok',
      trust,
      guildTrust,
      contractAddress: ca,
      callerContext,
      callSourceType: 'user_call',
      intentReason: isProCallMode ? 'hashtag_procall' : 'hashtag_call',
      proCall: proFields
    };
  }

  let scan;
  let realData;
  try {
    realData = await runQuickCa(ca);
    scan = normalizeRealDataToScan(realData);
  } catch (err) {
    touchXMentionDedupe(dedupeId, skipDedupeCheck, dryRun);
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
      callSourceType: 'user_call',
      intentReason: isProCallMode ? 'hashtag_procall' : 'hashtag_call',
      proCall: proFields,
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

  if (applyResult.wasNewCall === true && guild) {
    try {
      const needsDeferredChart =
        applyResult.wasNewCall &&
        !applyResult.wasReactivated &&
        applyResult.trackedCall?.callSourceType === 'user_call' &&
        isMilestoneChartAttachmentEnabled();

      let announcePayload = buildUserCallAnnouncementPayload(
        realData,
        scan,
        applyResult.trackedCall,
        applyResult.wasNewCall,
        applyResult.wasReactivated,
        {
          chartPhase: needsDeferredChart ? 'loading' : 'none',
          xOriginHandle: authorHandle,
          ...(isProCallMode
            ? {
              proCall: {
                title: proFields?.title || '',
                why: proFields?.why || '',
                risk: proFields?.risk || '',
                tweetUrl:
                  dedupeId && authorHandle
                    ? `https://x.com/${String(authorHandle).replace(/^@+/, '')}/status/${dedupeId}`
                    : ''
              }
            }
            : {})
        }
      );

      if (!needsDeferredChart) {
        announcePayload = await augmentNewUserCallPayloadWithChart(
          announcePayload,
          applyResult.trackedCall,
          applyResult.wasNewCall,
          applyResult.wasReactivated
        );
      }

      const mirrorResult = await announceNewUserCallInUserCallsChannel(guild, announcePayload, {
        returnMessage: true
      });

      if (needsDeferredChart && mirrorResult.message) {
        void runDeferredUserCallChartEdits([mirrorResult.message], {
          realData,
          scan,
          trackedCall: applyResult.trackedCall,
          wasNewCall: applyResult.wasNewCall,
          wasReactivated: applyResult.wasReactivated,
          xOriginHandle: authorHandle
        });
      }
    } catch (err) {
      console.error('[XIntake] user-calls / token-calls mirror failed:', err.message);
    }
  }

  touchXMentionDedupe(dedupeId, skipDedupeCheck, dryRun);

  return {
    success: true,
    reason: 'tracked',
    tweetId: dedupeId || undefined,
    trust,
    guildTrust,
    contractAddress: ca,
    callerContext,
    intakeSource: X_CALL_INTAKE_SOURCE,
    callSourceType: 'user_call',
    intentReason: isProCallMode ? 'hashtag_procall' : 'hashtag_call',
    proCall: proFields,
    trackedCall: applyResult.trackedCall,
    wasNewCall: applyResult.wasNewCall,
    wasReactivated: applyResult.wasReactivated
  };
}

module.exports = {
  X_CALL_INTAKE_SOURCE,
  extractFirstSolanaCaFromText,
  extractXMentionHashtagLabels,
  hasXMentionExplicitCallHashtag,
  hasXMentionExplicitProCallHashtag,
  buildCallerContextFromVerifiedProfile,
  processVerifiedXMentionCallIntake,
  decideXMentionIntakeReply,
  buildXMentionSuccessReplyText
};
