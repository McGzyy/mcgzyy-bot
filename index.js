require('dotenv').config();

const fs = require('fs');
const path = require('path');

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const {
  handleBasicCommands,
  handleCallCommand,
  handleWatchCommand,
  isLikelySolanaCA
} = require('./commands/basicCommands');

const { startMonitoring, stopMonitoring } = require('./utils/monitoringEngine');
const { startAutoCallLoop, stopAutoCallLoop } = require('./utils/autoCallEngine');
const { createPost } = require('./utils/xPoster');

const {
  createAutoCallEmbed,
  createDevAddedEmbed,
  createDevCheckEmbed,
  createDevLaunchAddedEmbed,
  createDevLeaderboardEmbed,
  createCallerCardEmbed,
  createCallerLeaderboardEmbed,
  createSingleCallEmbed,
  createTopCallerTimeframeEmbed
} = require('./utils/alertEmbeds');

const {
  isTrackedDevsChannel,
  isDevFeedChannel,
  isLikelySolWallet,
  addTrackedDev,
  getTrackedDev,
  getAllTrackedDevs,
  parseDevInput,
  addLaunchToTrackedDev,
  updateTrackedDev,
  removeTrackedDev,
  removeLaunchFromTrackedDev,
  getDevRankData,
  getDevLeaderboard
} = require('./utils/devRegistryService');

const {
  getCallerStats,
  getCallerStatsRaw,
  getBotStats,
  getBotStatsRaw,
  getCallerLeaderboard,
  getTopCallerInTimeframe,
  getBestCallInTimeframe,
  getBestBotCallInTimeframe,
  getTopCallerEligibilityReport,
  TOP_CALLER_ELIGIBILITY
} = require('./utils/callerStatsService');

const {
  getTrackedCall,
  setApprovalStatus,
  clearApprovalRequest,
  getAllTrackedCalls,
  getRecentBotCalls,
  getApprovalStats,
  getPendingApprovals,
  addModerationTag,
  setModerationNotes,
  excludeTrackedCallsFromStatsByCaller,
  excludeTrackedBotCallsFromStats,
  setXPostState,
  resetAllTrackedCalls,
} = require('./utils/trackedCallsService');

const {
  loadScannerSettings,
  updateScannerSetting
} = require('./utils/scannerSettingsService');

const {
  getHighestEligibleApprovalMilestone,
  computeApprovalAthX
} = require('./utils/approvalMilestoneService');

const { buildXPostTextApproval } = require('./utils/xPostContent');
const {
  isMilestoneChartAttachmentEnabled,
  fetchTokenChartImageBuffer
} = require('./utils/tokenChartImage');
const { describeXPostForTrackedCall, isXPostDryRunEnabled } = require('./utils/xPostPreview');

const {
  upsertUserProfile,
  getAllUserProfiles,
  ensureUserProfileOnGuildJoin,
  previewMemberProfileBackfill,
  runMemberProfileBackfill,
  getUserProfileByDiscordId,
  CALLER_TRUST_LEVELS,
  normalizeCallerTrustLevel,
  getCallerTrustLevel,
  setCallerTrustLevel,
  setPublicCreditMode,
  startXVerification,
  getPendingXVerifications,
  completeXVerification,
  denyXVerification,
  setXVerificationReviewMessageMeta,
  clearXVerificationReviewMessageMeta,
  setTopCallerReviewMessageMeta,
  clearTopCallerReviewMessageMeta,
  dismissTopCallerCandidate,
  resolveTopCallerReview,
  getPreferredPublicName,
  normalizeXHandle,
  isLikelyXHandle
} = require('./utils/userProfileService');

const { processVerifiedXMentionCallIntake } = require('./utils/xCallIntakeService');
const {
  startXMentionIngestionScaffold,
  runInjectedMentionOnce,
  logXMentionIngestionReadyDiagnostics
} = require('./utils/xMentionIngestionScaffold');

const { getModQueuesSnapshot } = require('./utils/modQueueService');
const { parseProCallCommandArgs } = require('./utils/proCallText');
const { extractFirstSolanaCaFromText } = require('./utils/solanaAddress');

function parseMentionedUserIdFromContent(message) {
  const mentioned = message?.mentions?.users?.first?.();
  if (mentioned?.id) return String(mentioned.id);
  const m = String(message?.content || '').match(/<@!?(\\d+)>/);
  return m ? String(m[1]) : '';
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const devEditSessions = new Map();
const DEV_EDIT_SESSION_TTL_MS = 10 * 60 * 1000;

const xVerificationSessions = new Map();
const X_VERIFY_SESSION_TTL_MS = 30 * 60 * 1000;
const X_VERIFY_CHANNEL_NAME = 'verify-x';
const X_VERIFIED_ROLE_NAME = 'X Verified';
const MOD_CHANNEL_NAME = 'mod-chat';
const MOD_APPROVALS_CHANNEL_NAME = 'mod-approvals';

const BOT_SETTINGS_PATH = path.join(__dirname, 'data', 'botSettings.json');

function loadBotSettings() {
  try {
    if (!fs.existsSync(BOT_SETTINGS_PATH)) {
      const defaults = { scannerEnabled: true };
      fs.writeFileSync(BOT_SETTINGS_PATH, JSON.stringify(defaults, null, 2), 'utf8');
      return defaults;
    }

    const raw = fs.readFileSync(BOT_SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    return {
      scannerEnabled: parsed.scannerEnabled !== false
    };
  } catch (error) {
    console.error('[BotSettings] Failed to load settings:', error.message);
    return { scannerEnabled: true };
  }
}

function saveBotSettings(settings) {
  try {
    fs.writeFileSync(BOT_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
  } catch (error) {
    console.error('[BotSettings] Failed to save settings:', error.message);
  }
}

let BOT_SETTINGS = loadBotSettings();
let SCANNER_ENABLED = BOT_SETTINGS.scannerEnabled;

function extractSolanaAddress(text) {
  return extractFirstSolanaCaFromText(text);
}

function createDevSessionKey(userId, channelId) {
  return `${userId}:${channelId}`;
}

function setDevEditSession(userId, channelId, session) {
  devEditSessions.set(createDevSessionKey(userId, channelId), {
    ...session,
    updatedAt: Date.now()
  });
}

function getDevEditSession(userId, channelId) {
  const key = createDevSessionKey(userId, channelId);
  const session = devEditSessions.get(key);

  if (!session) return null;

  if ((Date.now() - session.updatedAt) > DEV_EDIT_SESSION_TTL_MS) {
    devEditSessions.delete(key);
    return null;
  }

  return session;
}

function clearDevEditSession(userId, channelId) {
  devEditSessions.delete(createDevSessionKey(userId, channelId));
}

function createXVerifySessionKey(userId, channelId) {
  return `${userId}:${channelId}`;
}

function generateVerificationCode(userId, handle) {
  const suffix = Math.floor(100000 + Math.random() * 900000);
  return `MCGZYY-${normalizeXHandle(handle).toUpperCase()}-${suffix}`.slice(0, 32);
}

function setXVerifySession(userId, channelId, session) {
  xVerificationSessions.set(createXVerifySessionKey(userId, channelId), {
    ...session,
    updatedAt: Date.now()
  });
}

function getXVerifySession(userId, channelId) {
  const key = createXVerifySessionKey(userId, channelId);
  const session = xVerificationSessions.get(key);

  if (!session) return null;

  if ((Date.now() - session.updatedAt) > X_VERIFY_SESSION_TTL_MS) {
    xVerificationSessions.delete(key);
    return null;
  }

  return session;
}

function clearXVerifySession(userId, channelId) {
  xVerificationSessions.delete(createXVerifySessionKey(userId, channelId));
}

function clearXVerifySessionsForUser(userId) {
  const prefix = `${String(userId)}:`;
  for (const key of [...xVerificationSessions.keys()]) {
    if (key.startsWith(prefix)) {
      xVerificationSessions.delete(key);
    }
  }
}

async function replyText(message, content) {
  await message.reply({
    content,
    allowedMentions: { repliedUser: false }
  });
}

function buildTestXIntakeResultEmbed(result, { applyMode, authorHandle, tweetId, tweetTextSample }) {
  const duplicate = !!(result.duplicate || result.alreadyProcessed);
  const color = duplicate
    ? 0x94a3b8
    : result.success
      ? applyMode
        ? 0x22c55e
        : 0xf59e0b
      : 0xef4444;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(applyMode ? '🧪 X intake test — LIVE APPLY' : '🧪 X intake test — dry-run')
    .setTimestamp();

  embed.addFields(
    { name: 'X handle', value: `\`${authorHandle}\``, inline: true },
    { name: 'Tweet / dedupe ID', value: `\`${tweetId}\``, inline: true },
    {
      name: 'Mode',
      value: applyMode ? '**Writes** `trackedCalls` + dedupe id' : '**No write** (preview only)',
      inline: true
    }
  );

  if (tweetTextSample) {
    const clip =
      tweetTextSample.length > 900 ? `${tweetTextSample.slice(0, 900)}…` : tweetTextSample;
    embed.addFields({ name: 'Tweet text', value: clip || '—', inline: false });
  }

  if (duplicate) {
    embed.addFields({
      name: 'Duplicate',
      value: '**Yes** — `already_processed` (pipeline not run)',
      inline: false
    });
    embed.setFooter({ text: 'Use a fresh tweetId or clear dedupe store to re-test.' });
    return embed;
  }

  const xTrustLine = result.trust
    ? result.trust.allowed
      ? '✅ Linked verified profile'
      : `❌ \`${result.trust.reason}\`${result.replyMessage ? `\n${result.replyMessage}` : ''}`
    : '—';

  embed.addFields({ name: 'X trust', value: xTrustLine, inline: false });

  let guildLine = '—';
  if (result.guildTrustDenied && result.guildTrust) {
    guildLine =
      `❌ \`${result.guildTrust.reason}\`` +
      (result.replyMessage ? `\n${result.replyMessage}` : '');
  } else if (result.guildTrust && result.guildTrust.ok === true) {
    guildLine = '✅ Linked user is in this server';
  } else if (result.guildTrust && result.guildTrust.ok === false) {
    guildLine = `❌ \`${result.guildTrust.reason}\``;
  } else if (result.reason === 'missing_discord_user_id_for_guild_check') {
    guildLine = '❌ Linked profile has no `discordUserId`';
  } else if (result.trustDenied || (result.trust && !result.trust.allowed)) {
    guildLine = '— (skipped after X trust)';
  }

  embed.addFields({ name: 'Guild trust', value: guildLine, inline: false });

  embed.addFields({
    name: 'Extracted CA',
    value: result.contractAddress ? `\`${result.contractAddress}\`` : '—',
    inline: true
  });

  embed.addFields({
    name: 'Pipeline',
    value: `\`${result.reason || 'unknown'}\`${result.error ? `\n\`${String(result.error).slice(0, 400)}\`` : ''}`,
    inline: false
  });

  if (result.callSourceType) {
    embed.addFields({
      name: 'X mention → applyTrackedCallState',
      value: `\`${result.callSourceType}\`${result.intentReason ? ` · \`${result.intentReason}\`` : ''}`,
      inline: false
    });
  }

  if (result.callerContext?.discordUserId) {
    embed.addFields({
      name: 'Caller context',
      value: `\`${result.callerContext.discordUserId}\` · ${result.callerContext.displayName || result.callerContext.username}`,
      inline: false
    });
  }

  if (result.scanPreview) {
    const t = result.scanPreview.ticker || '?';
    embed.addFields({
      name: 'Would apply (scan)',
      value: `**${result.scanPreview.tokenName}** (${t}) · MC **${result.scanPreview.marketCap}**`,
      inline: false
    });
  }

  if (applyMode && result.success && result.reason === 'tracked') {
    embed.addFields({
      name: 'Tracked call',
      value:
        `**Created:** ${result.wasNewCall ? 'yes (new row / first call)' : 'no'} · **Reactivated:** ${result.wasReactivated ? 'yes' : 'no'}`,
      inline: false
    });
    embed.setFooter({ text: 'Dedupe id stored — repeat same tweetId returns already_processed.' });
  } else if (result.dryRun && result.success) {
    embed.setFooter({
      text: 'Dry-run: no tracked-call write, dedupe id not recorded. Owner: !testxintake apply …'
    });
  } else if (applyMode && result.reason === 'no_explicit_call_hashtag') {
    embed.setFooter({
      text: 'Dedupe id stored — tweet had no #call (no track / mirror / X reply, same as live ingestion).'
    });
  }

  return embed;
}

function parseTestXmentionContent(content) {
  let rest = content.replace(/^!testxmention\s*/i, '').trim();
  let applyMode = false;

  if (/^apply(\s|$)/i.test(rest)) {
    applyMode = true;
    rest = rest.replace(/^apply\s+/i, '').trim();
  }

  const parts = rest.split(/\s+/);
  if (parts.length < 3) {
    return { error: 'usage' };
  }

  const authorHandle = parts[0];
  const tweetId = parts[1];
  let idx = 2;
  let replyToTweetId;

  if (parts[idx] && /^(?:to|reply):/i.test(parts[idx])) {
    const m = parts[idx].match(/^(?:to|reply):(\d+)$/i);
    if (!m) {
      return { error: 'bad_reply' };
    }
    replyToTweetId = m[1];
    idx++;
  }

  const tweetText = parts.slice(idx).join(' ');
  if (!tweetText) {
    return { error: 'usage' };
  }

  return { authorHandle, tweetId, tweetText, replyToTweetId, applyMode };
}

function describeInjectReplyOutcome(replyOutcome, dryRunIntake) {
  if (!replyOutcome) {
    return '—';
  }

  if (replyOutcome.attempted === true) {
    if (replyOutcome.out?.dryRun) {
      return '**Simulated** — X poster dry-run / preview (`X_POST_DRY_RUN` or equivalent): no live tweet id.';
    }
    if (replyOutcome.posted) {
      return '**Posted** reply on X.';
    }
    const errBit = replyOutcome.out?.error || replyOutcome.out?.message || '';
    return `**Attempted** X API — **not posted**${errBit ? `\n\`${String(errBit).slice(0, 400)}\`` : ''}`;
  }

  if (replyOutcome.reason === 'no_reply_plan') {
    return '**No post** — reply policy did not request a reply for this outcome.';
  }

  if (replyOutcome.reason === 'env_gate') {
    return '**Held** — `X_MENTION_POST_REPLIES` is not enabled (no real reply).';
  }

  if (replyOutcome.reason === 'reply_step_not_requested') {
    return '**Skipped** — reply step was not requested for this run.';
  }

  if (replyOutcome.reason === 'dry_run_intake' || dryRunIntake) {
    const lines = ['**Skipped** — inject **dry-run**: `maybePostIntakeReply` not called.'];
    if (replyOutcome.policyShouldReply) {
      const envOk = replyOutcome.xMentionPostRepliesEnv;
      const xDry = isXPostDryRunEnabled();
      let hypo = 'If you used owner **`apply`** with the same payload: ';
      if (!envOk) {
        hypo += 'reply still **held** until `X_MENTION_POST_REPLIES`. ';
      } else if (xDry) {
        hypo += 'X poster would **simulate** (dry-run env). ';
      } else {
        hypo += 'would **attempt** a live reply to `targetReplyId`. ';
      }
      lines.push(hypo.trim());
    } else {
      lines.push('Policy **would not** post a reply for this intake path.');
    }
    return lines.join('\n');
  }

  return `\`${replyOutcome.reason || 'unknown'}\`\n${replyOutcome.note || ''}`.trim();
}

function buildTestXMentionInjectEmbed(
  injectResult,
  { applyMode, authorHandle, tweetId, tweetTextSample, replyToTweetId }
) {
  if (!injectResult?.ok) {
    const msg =
      injectResult?.error === 'invalid_candidate'
        ? 'Invalid candidate (need handle, numeric tweet id, and tweet text).'
        : 'Inject failed.';
    return new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle('🧪 X mention ingest inject — error')
      .setDescription(msg)
      .setTimestamp();
  }

  const { bundle, replyOutcome } = injectResult;
  const { result, plan, targetReplyId, dryRun } = bundle;
  const duplicate = !!(result.duplicate || result.alreadyProcessed);

  const color = duplicate
    ? 0x94a3b8
    : result.success
      ? applyMode
        ? 0x22c55e
        : 0xf59e0b
      : 0xef4444;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(
      applyMode
        ? '🧪 X mention ingest — LIVE apply + reply step'
        : '🧪 X mention ingest — dry-run (scaffold path)'
    )
    .setTimestamp();

  embed.addFields(
    { name: 'X handle', value: `\`${authorHandle}\``, inline: true },
    { name: 'Tweet / dedupe id', value: `\`${tweetId}\``, inline: true },
    {
      name: 'Pipeline',
      value:
        `Intake **${dryRun ? 'dry-run' : 'live'}** · same as \`processSingleCandidate\` → \`decideXMentionIntakeReply\`${applyMode ? ' → `maybePostIntakeReply`' : ''}`,
      inline: false
    }
  );

  if (replyToTweetId) {
    embed.addFields({
      name: 'Reply target (in_reply_to)',
      value: `\`${replyToTweetId}\` (falls back to tweet id if omitted)`,
      inline: false
    });
  }

  embed.addFields({
    name: 'createPost reply id',
    value: `\`${targetReplyId}\``,
    inline: true
  });

  if (tweetTextSample) {
    const clip =
      tweetTextSample.length > 700 ? `${tweetTextSample.slice(0, 700)}…` : tweetTextSample;
    embed.addFields({ name: 'Tweet text', value: clip || '—', inline: false });
  }

  if (duplicate) {
    embed.addFields({
      name: 'Dedupe',
      value: '`already_processed` — intake short-circuited',
      inline: false
    });
    embed.addFields({
      name: 'Reply decision',
      value: `\`${plan.case}\` · shouldReply **${plan.shouldReply ? 'yes' : 'no'}**`,
      inline: false
    });
    embed.addFields({
      name: 'X reply step',
      value: describeInjectReplyOutcome(replyOutcome, dryRun),
      inline: false
    });
    embed.setFooter({ text: 'Use a fresh tweetId for a full pipeline test.' });
    return embed;
  }

  const xTrustLine = result.trust
    ? result.trust.allowed
      ? '✅ Linked verified profile'
      : `❌ \`${result.trust.reason}\`${result.replyMessage ? `\n${result.replyMessage}` : ''}`
    : '—';

  embed.addFields({ name: 'X trust', value: xTrustLine, inline: false });

  let guildLine = '—';
  if (result.guildTrustDenied && result.guildTrust) {
    guildLine =
      `❌ \`${result.guildTrust.reason}\`` +
      (result.replyMessage ? `\n${result.replyMessage}` : '');
  } else if (result.guildTrust && result.guildTrust.ok === true) {
    guildLine = '✅ Linked user is in this server';
  } else if (result.guildTrust && result.guildTrust.ok === false) {
    guildLine = `❌ \`${result.guildTrust.reason}\``;
  } else if (result.reason === 'missing_discord_user_id_for_guild_check') {
    guildLine = '❌ Linked profile has no `discordUserId`';
  } else if (result.trustDenied || (result.trust && !result.trust.allowed)) {
    guildLine = '— (skipped after X trust)';
  }

  embed.addFields({ name: 'Guild trust', value: guildLine, inline: false });

  embed.addFields({
    name: 'Intake result',
    value:
      `success **${result.success ? 'yes' : 'no'}** · \`${result.reason || 'unknown'}\`` +
      (result.error ? `\n\`${String(result.error).slice(0, 300)}\`` : ''),
    inline: false
  });

  if (result.callSourceType) {
    embed.addFields({
      name: 'applyTrackedCallState',
      value: `\`${result.callSourceType}\`${result.intentReason ? ` · \`${result.intentReason}\`` : ''}`,
      inline: false
    });
  }

  embed.addFields({
    name: 'Extracted CA',
    value: result.contractAddress ? `\`${result.contractAddress}\`` : '—',
    inline: true
  });

  if (result.scanPreview) {
    const t = result.scanPreview.ticker || '?';
    embed.addFields({
      name: 'Scan preview',
      value: `**${result.scanPreview.tokenName}** (${t}) · MC **${result.scanPreview.marketCap}**`,
      inline: false
    });
  }

  const policyTextClip =
    plan.text && plan.text.length > 400 ? `${plan.text.slice(0, 400)}…` : plan.text || '—';

  embed.addFields({
    name: 'Reply decision',
    value:
      `case \`${plan.case}\` · shouldReply **${plan.shouldReply ? 'yes' : 'no'}**` +
      (plan.shouldReply ? `\nPreview:\n${policyTextClip}` : ''),
    inline: false
  });

  embed.addFields({
    name: 'X reply step',
    value: describeInjectReplyOutcome(replyOutcome, dryRun),
    inline: false
  });

  if (applyMode && result.success && result.reason === 'tracked') {
    embed.addFields({
      name: 'Tracked call',
      value: `**New:** ${result.wasNewCall ? 'yes' : 'no'} · **Reactivated:** ${result.wasReactivated ? 'yes' : 'no'}`,
      inline: false
    });
  }

  if (!applyMode) {
    embed.setFooter({
      text: 'Default is dry-run. Owner: !testxmention apply … — replies only if X_MENTION_POST_REPLIES + X poster not in dry-run.'
    });
  } else {
    embed.setFooter({
      text: 'Live apply wrote dedupe when tracked; reply gated by X_MENTION_POST_REPLIES and X poster env.'
    });
  }

  return embed;
}

function getBotCallsChannel(guild) {
  if (!guild) return null;

  return guild.channels.cache.find(
    ch =>
      ch &&
      ch.isTextBased &&
      typeof ch.isTextBased === 'function' &&
      ch.isTextBased() &&
      ch.name === 'bot-calls'
  ) || null;
}

function getModChannel(guild) {
  if (!guild) return null;

  return guild.channels.cache.find(
    ch =>
      ch &&
      ch.isTextBased &&
      typeof ch.isTextBased === 'function' &&
      ch.isTextBased() &&
      ch.name === MOD_CHANNEL_NAME
  ) || null;
}

function getModApprovalsChannel(guild) {
  if (!guild) return null;

  return guild.channels.cache.find(
    ch =>
      ch &&
      ch.isTextBased &&
      typeof ch.isTextBased === 'function' &&
      ch.isTextBased() &&
      ch.isTextBased() &&
      ch.name === MOD_APPROVALS_CHANNEL_NAME
  ) || null;
}
function getXApprovalChannel(guild) {
  if (!guild) return null;

  return guild.channels.cache.find(
    ch =>
      ch &&
      ch.isTextBased &&
      typeof ch.isTextBased === 'function' &&
      ch.isTextBased() &&
      ch.name === 'x-approvals'
  ) || null;
}
async function assignXVerifiedRole(member) {
  try {
    if (!member?.guild) return false;

    const role = member.guild.roles.cache.find(r => r.name === X_VERIFIED_ROLE_NAME);
    if (!role) return false;

    if (member.roles.cache.has(role.id)) return true;

    await member.roles.add(role);
    return true;
  } catch (error) {
    console.error('[XVerify] Failed to assign role:', error.message);
    return false;
  }
}

function buildUserProfileEmbed(profile) {
  const mode = profile?.publicSettings?.publicCreditMode || 'discord_name';
  const modeLabel =
    mode === 'anonymous' ? 'Anonymous' :
    mode === 'verified_x_tag' ? 'Verified X Tag' :
    'Discord Name';

  const xStatus = profile?.isXVerified
    ? `✅ Verified (@${profile.verifiedXHandle})`
    : profile?.xVerification?.status === 'pending'
      ? `⏳ Pending (@${profile.xVerification.requestedHandle || profile.xHandle || 'unknown'})`
      : 'Not verified';

  const previewName = getPreferredPublicName(profile);

  const callerLookup =
    profile?.discordUserId ||
    profile?.username ||
    profile?.displayName ||
    '';

  const stats = callerLookup ? getCallerStats(callerLookup) : null;

  const totalCalls = stats?.totalCalls ?? 0;
  const approvedCalls = stats?.approvedCalls ?? 0;
  const bestX = Number(stats?.bestX ?? 0);
  const bestCallToken = stats?.bestCallToken || null;

  const bestCallLine =
    bestX > 0
      ? `${bestX.toFixed(2)}x${bestCallToken ? ` (${bestCallToken})` : ''}`
      : 'No tracked winners yet';

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`👤 Caller Profile — ${profile.displayName || profile.username || 'Unknown'}`)
    .setDescription([
      `**Public Preview:** ${previewName}`,
      `**Credit Mode:** ${modeLabel}`,
      `**X Verification:** ${xStatus}`,
      '',
      `**📊 Total Calls:** ${totalCalls}`,
      `**✅ Approved Calls:** ${approvedCalls}`,
      `**🚀 Best Call:** ${bestCallLine}`
    ].join('\n'))
    .setFooter({ text: 'Profile + caller performance snapshot' })
    .setTimestamp();
}

function buildProfileButtons(profile) {
  const mode = profile?.publicSettings?.publicCreditMode || 'discord_name';

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('profile_set_credit:anonymous')
        .setLabel(mode === 'anonymous' ? '✓ Anonymous' : 'Anonymous')
        .setStyle(mode === 'anonymous' ? ButtonStyle.Success : ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId('profile_set_credit:discord_name')
        .setLabel(mode === 'discord_name' ? '✓ Discord Name' : 'Discord Name')
        .setStyle(mode === 'discord_name' ? ButtonStyle.Success : ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId('profile_set_credit:verified_x_tag')
        .setLabel(mode === 'verified_x_tag' ? '✓ Verified X Tag' : 'Verified X Tag')
        .setStyle(mode === 'verified_x_tag' ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(!profile?.isXVerified)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('profile_open_verify_modal')
        .setLabel(profile?.isXVerified ? 'Update X Verification' : 'Verify X')
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function buildVerifyXChannelEmbed() {
  return new EmbedBuilder()
    .setColor(0x1d9bf0)
    .setTitle('🧪 Verify Your X Handle')
    .setDescription([
      'Click the button below to verify ownership of your X account.',
      '',
      'Once you submit your handle, the bot will give you a code to:',
      '• put in your X bio, or',
      '• post in a tweet',
      '',
      'Then click **Submit for Review** and a mod will verify it.'
    ].join('\n'))
    .setTimestamp();
}

function buildVerifyXChannelButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('profile_open_verify_modal')
        .setLabel('Verify X')
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function buildVerifyXHandleModal() {
  return new ModalBuilder()
    .setCustomId('verify_x_handle_modal')
    .setTitle('Verify Your X Handle')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('x_handle_input')
          .setLabel('Enter your X handle')
          .setPlaceholder('e.g. McGzyy')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
      )
    );
}

function buildXVerifySubmitButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('xverify_submit_review')
        .setLabel('Submit for Review')
        .setStyle(ButtonStyle.Success)
    )
  ];
}

function buildXVerifyEmbed({ user, handle, code }) {
  return new EmbedBuilder()
    .setColor(0x1d9bf0)
    .setTitle('🧪 X Verification Request')
    .setDescription([
      `**User:** <@${user.id}> (${user.username})`,
      `**Handle:** [@${handle}](https://x.com/${handle})`,
      `**Verification Code:** \`${code}\``,
      '',
      'Verify that the code exists in bio or tweet.'
    ].join('\n'))
    .setTimestamp();
}

function buildXVerifyButtons(userId, handle) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`xverify_accept:${userId}:${handle}`)
        .setLabel('Accept')
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`xverify_deny:${userId}:${handle}`)
        .setLabel('Deny')
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function buildTopCallerCandidateButtons(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`topcaller_approve:${userId}`)
        .setLabel('Approve Top Caller')
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`topcaller_dismiss:${userId}`)
        .setLabel('Dismiss (7d)')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function buildTopCallerCandidateContent({ userId, trust, report }) {
  const valid = report?.validCallCount ?? 0;
  const avgX = Number(report?.avgX || 0);
  const bestX = Number(report?.bestX || 0);
  const bestToken = report?.bestToken ? ` — ${report.bestToken}` : '';

  return [
    '🏆 **Top Caller Candidate**',
    `**User:** <@${userId}>`,
    `**Current Trust:** \`${trust}\``,
    `**Valid Calls:** ${valid}`,
    `**Avg X:** ${avgX.toFixed(2)}x`,
    `**Best Call:** ${bestX.toFixed(2)}x${bestToken}`,
    `**Eligible:** **${report?.eligibility || 'UNKNOWN'}**`
  ].join('\n');
}

function buildApprovalButtons(contractAddress) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`approve_call:${contractAddress}`)
        .setLabel('Approve')
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`deny_call:${contractAddress}`)
        .setLabel('Deny')
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId(`exclude_call:${contractAddress}`)
        .setLabel('Exclude')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function buildModerationFollowupButtons(contractAddress) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tag_call:${contractAddress}`)
        .setLabel('Add Tag')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId(`note_call:${contractAddress}`)
        .setLabel('Add Note')
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId(`done_call:${contractAddress}`)
        .setLabel('Done')
        .setStyle(ButtonStyle.Success)
    )
  ];
}

function formatUsd(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'N/A';
  return `$${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatX(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 'N/A';
  return `${num.toFixed(2)}x`;
}

function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'N/A';
  return `${num.toFixed(1)}%`;
}

function formatDateTime(iso) {
  if (!iso) return 'N/A';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'N/A';

  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function getResolutionLines(trackedCall) {
  const status = trackedCall.approvalStatus || 'pending';

  if (status === 'pending') return [];

  const actionLabel =
    status === 'approved' ? 'Approved' :
    status === 'denied' ? 'Denied' :
    status === 'excluded' ? 'Excluded' :
    status === 'expired' ? 'Expired' :
    'Resolved';

  const moderator = trackedCall.moderatedByUsername || 'Unknown';
  const moderatedAt = formatDateTime(trackedCall.moderatedAt);

  const lines = [
    '',
    '**Resolution**',
    `**${actionLabel} By:** ${moderator}`,
    `**${actionLabel} At:** ${moderatedAt}`
  ];

  if (status === 'approved') {
    const postedMilestones = Array.isArray(trackedCall.xPostedMilestones)
      ? trackedCall.xPostedMilestones
      : [];

    const lastMilestone = postedMilestones.length
      ? postedMilestones[postedMilestones.length - 1]
      : null;

    const postType = trackedCall.xOriginalPostId && !trackedCall.xLastReplyPostId
      ? 'Original Thread'
      : trackedCall.xLastReplyPostId
        ? 'Reply Post'
        : trackedCall.xOriginalPostId
          ? 'Original Thread'
          : 'Not Posted';

    lines.push(`**Posted to X:** ${trackedCall.xOriginalPostId || trackedCall.xLastReplyPostId ? 'Yes' : 'No'}`);
    lines.push(`**Post Type:** ${postType}`);
    lines.push(`**Last X Milestone:** ${lastMilestone ? `${lastMilestone}x` : 'N/A'}`);
    lines.push(`**X Post ID:** ${trackedCall.xLastReplyPostId || trackedCall.xOriginalPostId || 'N/A'}`);
  }

  return lines;
}

function buildApprovalStatusEmbed(trackedCall, scan = null) {
  const ath = Number(
    trackedCall.ath ||
    trackedCall.athMc ||
    trackedCall.athMarketCap ||
    trackedCall.latestMarketCap ||
    trackedCall.firstCalledMarketCap ||
    0
  );

  const firstCalledMc = Number(trackedCall.firstCalledMarketCap || 0);
  const currentMc = Number(trackedCall.latestMarketCap || 0);
  const x = firstCalledMc > 0 ? ath / firstCalledMc : 0;
  const currentX = firstCalledMc > 0 ? currentMc / firstCalledMc : 0;
  const drawdown = ath > 0 ? ((ath - currentMc) / ath) * 100 : 0;

  const status = trackedCall.approvalStatus || 'pending';
  const statusLabel =
    status === 'approved' ? '✅ APPROVED' :
    status === 'denied' ? '❌ DENIED' :
    status === 'excluded' ? '🗑 EXCLUDED' :
    status === 'expired' ? '⌛ EXPIRED' :
    '⏳ PENDING REVIEW';

  const tags = Array.isArray(trackedCall.moderationTags) && trackedCall.moderationTags.length
    ? trackedCall.moderationTags.map(t => `\`${t}\``).join(' ')
    : 'None';

  const ca = trackedCall.contractAddress;
  const links = [
    `[Axiom](https://axiom.trade/token/${ca})`,
    `[GMGN](https://gmgn.ai/sol/token/${ca})`,
    `[Dexscreener](https://dexscreener.com/solana/${ca})`
  ].join(' | ');

  let callerLabel = 'Unknown';

if (trackedCall.callSourceType === 'bot_call') {
  callerLabel = 'McGBot';
} else if (trackedCall.callSourceType === 'watch_only') {
  callerLabel = 'No caller credit';
} else {
  callerLabel =
    getPreferredPublicName(
      getUserProfileByDiscordId(trackedCall.firstCallerDiscordId || trackedCall.firstCallerId || '')
    ) ||
    trackedCall.firstCallerPublicName ||
    trackedCall.firstCallerDisplayName ||
    trackedCall.firstCallerUsername ||
    'Unknown';
}

  const handledBy =
    trackedCall.moderatedById
      ? `<@${trackedCall.moderatedById}>`
      : trackedCall.moderatedByUsername
      ? trackedCall.moderatedByUsername
      : '';

  const showReason =
    (status === 'denied' || status === 'excluded') &&
    typeof trackedCall.moderationNotes === 'string' &&
    trackedCall.moderationNotes.trim().length > 0;

  const actionTitle =
    status === 'approved' ? '✅ Coin Approved' :
    status === 'denied' ? '❌ Coin Denied' :
    status === 'excluded' ? '🗑 Coin Excluded' :
    status === 'expired' ? '⌛ Coin Approval Expired' :
    '⏳ Coin Pending Review';

  const typeLabel =
    trackedCall.callSourceType === 'bot_call'
      ? 'Bot Call'
      : trackedCall.callSourceType === 'watch_only'
      ? 'Watch Only'
      : 'User Call';

  const descriptionLines = [
    `## ${actionTitle}`,
    '',
    `**Token:** ${trackedCall.tokenName || 'Unknown'} (${trackedCall.ticker ? `$${trackedCall.ticker}` : 'No ticker'})`,
    `**CA:** \`${ca}\``,
    `**Type:** ${typeLabel}`,
    handledBy ? `**Handled by:** ${handledBy}` : null,
    showReason ? `**Reason:** ${trackedCall.moderationNotes.trim()}` : null,
    '',
    `**Links:** ${links}`,
    '',
    `### Performance`,
    `**Current X:** ${formatX(currentX)} • **ATH X:** ${formatX(x)} • **Trigger:** ${formatX(trackedCall.lastApprovalTriggerX)}`,
    `**Current MC:** ${formatUsd(currentMc)} • **ATH MC:** ${formatUsd(ath)}`,
    `**Drawdown from ATH:** ${formatPercent(drawdown)}`,
    '',
    `### Call Details`,
    `**Caller:** ${callerLabel}`,
    `**First Called MC:** ${formatUsd(firstCalledMc)}`,
    `**Excluded From Stats:** ${trackedCall.excludedFromStats ? 'Yes' : 'No'}`,
    `**Tags:** ${tags}`,
    `**Notes:** ${trackedCall.moderationNotes || 'None'}`
  ].filter(Boolean);

  descriptionLines.push(...getResolutionLines(trackedCall));

  const embed = new EmbedBuilder()
    .setColor(
      status === 'approved' ? 0x22c55e :
      status === 'denied' ? 0xef4444 :
      status === 'excluded' ? 0x64748b :
      status === 'expired' ? 0x94a3b8 :
      0xf59e0b
    )
    .setTitle(`🧪 COIN APPROVAL REVIEW — ${trackedCall.tokenName || 'Unknown Token'} ($${trackedCall.ticker || 'UNKNOWN'})`)
    .setDescription(descriptionLines.join('\n'))
    .setFooter({
      text:
        status === 'pending'
          ? 'Awaiting mod review'
          : 'Moderation record saved'
    })
    .setTimestamp();

  if (scan?.contractAddress) {
    embed.addFields({
      name: '📡 Source',
      value: scan.alertType || 'Tracked Call',
      inline: false
    });
  }

  return embed;
}

async function publishApprovedCoinToX(contractAddress) {
  const trackedCall = getTrackedCall(contractAddress);
  if (!trackedCall) return { success: false, reason: 'missing_call' };
  if (!trackedCall.xApproved) return { success: false, reason: 'not_approved' };

  const milestoneX = getHighestEligibleApprovalMilestone(computeApprovalAthX(trackedCall));

  if (!milestoneX) {
    return { success: false, reason: 'no_milestone' };
  }

  const postedMilestones = Array.isArray(trackedCall.xPostedMilestones)
    ? trackedCall.xPostedMilestones
    : [];

  if (postedMilestones.includes(milestoneX)) {
    return { success: false, reason: 'already_posted' };
  }

  const hasOriginal = !!trackedCall.xOriginalPostId;

  const postText = buildXPostTextApproval(trackedCall, milestoneX, hasOriginal);
  let chartBuf = null;
  if (isMilestoneChartAttachmentEnabled()) {
    chartBuf = await fetchTokenChartImageBuffer(trackedCall);
  }
  const result = await createPost(postText, hasOriginal ? trackedCall.xOriginalPostId : null, {
    chartImageBuffer: chartBuf
  });

  if (!result.success || (!result.dryRun && !result.id)) {
    return {
      success: false,
      reason: 'x_post_failed',
      error: result.error || null
    };
  }

  if (result.dryRun) {
    return {
      success: true,
      dryRun: true,
      milestoneX,
      reply: hasOriginal,
      postId: null,
      bodyPreview: postText,
      wouldReplyToTweetId: hasOriginal ? trackedCall.xOriginalPostId : null
    };
  }

  const updatedMilestones = [...postedMilestones, milestoneX].sort((a, b) => a - b);

  const updates = {
    xLastPostedAt: new Date().toISOString(),
    xPostedMilestones: updatedMilestones
  };

  if (!hasOriginal) {
    updates.xOriginalPostId = result.id;
  } else {
    updates.xLastReplyPostId = result.id;
  }

  setXPostState(contractAddress, updates);

  return {
    success: true,
    milestoneX,
    reply: hasOriginal,
    postId: result.id
  };
}

async function deleteApprovalMessage(guild, trackedCall) {
  try {
    if (!trackedCall?.approvalChannelId || !trackedCall?.approvalMessageId || !guild) return false;

    const channel = guild.channels.cache.get(trackedCall.approvalChannelId);
    if (!channel || !channel.isTextBased()) return false;

    const message = await channel.messages.fetch(trackedCall.approvalMessageId).catch(() => null);
    if (!message) return false;

    await message.delete().catch(() => null);
    return true;
  } catch (error) {
    console.error('[ApprovalQueue] Failed to delete approval message:', error.message);
    return false;
  }
}

async function cleanupExpiredApprovals() {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    const allCalls = getAllTrackedCalls();
    const now = Date.now();

    for (const trackedCall of allCalls) {
      if (!trackedCall.approvalMessageId || !trackedCall.approvalExpiresAt) continue;
      if (trackedCall.approvalStatus !== 'pending') continue;

      const expiresAt = new Date(trackedCall.approvalExpiresAt).getTime();
      if (!Number.isFinite(expiresAt)) continue;

      if (now >= expiresAt) {
        setApprovalStatus(trackedCall.contractAddress, 'expired');
        await refreshApprovalMessage(guild, trackedCall.contractAddress, true);

        console.log(`[ApprovalQueue] Expired approval marked for ${trackedCall.contractAddress}`);
      }
    }
  } catch (error) {
    console.error('[ApprovalQueue] Cleanup error:', error.message);
  }
}

async function cleanupResolvedModApprovals() {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    const modApprovals = getModApprovalsChannel(guild);
    if (!modApprovals) return;

    const now = Date.now();
    const TTL_MS = 24 * 60 * 60 * 1000;

    // X verification review messages: delete once resolved for 24h.
    const profiles = getAllUserProfiles();
    for (const profile of profiles) {
      const v = profile?.xVerification || {};
      if (!v.reviewMessageId || !v.reviewChannelId) continue;
      if (String(v.reviewChannelId) !== String(modApprovals.id)) continue;

      const status = String(v.status || 'none').toLowerCase();
      if (status === 'pending') continue;

      const resolvedAt = new Date(v.reviewResolvedAt || v.deniedAt || 0).getTime();
      if (!Number.isFinite(resolvedAt) || resolvedAt <= 0) continue;
      if (now - resolvedAt < TTL_MS) continue;

      const msg = await modApprovals.messages.fetch(String(v.reviewMessageId)).catch(() => null);
      if (msg) await msg.delete().catch(() => null);

      if (profile.discordUserId) {
        clearXVerificationReviewMessageMeta(profile.discordUserId);
      }
    }

    // Coin approval messages posted into #mod-approvals: delete once resolved for 24h.
    const calls = getAllTrackedCalls();
    for (const call of calls) {
      if (!call?.approvalMessageId || !call?.approvalChannelId) continue;
      if (String(call.approvalChannelId) !== String(modApprovals.id)) continue;

      const status = String(call.approvalStatus || 'none').toLowerCase();
      if (status === 'pending') continue;

      const resolvedAt = new Date(call.moderatedAt || call.approvalExpiresAt || 0).getTime();
      if (!Number.isFinite(resolvedAt) || resolvedAt <= 0) continue;
      if (now - resolvedAt < TTL_MS) continue;

      await deleteApprovalMessage(guild, call);
      clearApprovalRequest(call.contractAddress);
    }

    // Top Caller candidate review messages: delete once resolved/dismissed for 24h.
    for (const profile of profiles) {
      const r = profile?.topCallerReview || {};
      if (!r.reviewMessageId || !r.reviewChannelId) continue;
      if (String(r.reviewChannelId) !== String(modApprovals.id)) continue;

      const resolvedAt = new Date(r.reviewResolvedAt || 0).getTime();
      if (!Number.isFinite(resolvedAt) || resolvedAt <= 0) continue;
      if (now - resolvedAt < TTL_MS) continue;

      const msg = await modApprovals.messages.fetch(String(r.reviewMessageId)).catch(() => null);
      if (msg) await msg.delete().catch(() => null);

      if (profile.discordUserId) {
        clearTopCallerReviewMessageMeta(profile.discordUserId);
      }
    }
  } catch (error) {
    console.error('[ModApprovals] Resolved cleanup error:', error.message);
  }
}

async function syncModApprovalsChannel() {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) return;

    const modApprovals = getModApprovalsChannel(guild);
    if (!modApprovals) return;

    // Use centralized snapshot so categories stay consistent and extensible.
    const snapshot = getModQueuesSnapshot({
      xLimit: 50,
      coinLimit: 50,
      topBotLimit: 8,
      topCallerLimit: 25
    });

    // 1) X verifications (oldest -> newest, so newer end up later in channel)
    const pendingX = snapshot?.queues?.xVerifications?.items || [];
    if (pendingX.length) {
      const orderedX = [...pendingX].sort((a, b) => {
        const aTime = new Date(a?.requestedAt || 0).getTime();
        const bTime = new Date(b?.requestedAt || 0).getTime();
        return aTime - bTime;
      });

      for (const item of orderedX) {
        const userId = item?.discordUserId ? String(item.discordUserId) : '';
        if (!userId) continue;

        const profile = getUserProfileByDiscordId(userId);
        if (!profile) continue;
        const v = profile?.xVerification || {};
        const status = String(v.status || 'none').toLowerCase();
        if (status !== 'pending') continue;

        const handle = v.requestedHandle || profile.xHandle || '';
        const code = v.verificationCode || '';
        if (!handle || !code) continue;

        const existingMsgId = String(v.reviewMessageId || '');
        const existingChId = String(v.reviewChannelId || '');

        if (existingMsgId && existingChId === String(modApprovals.id)) {
          const existingMsg = await modApprovals.messages.fetch(existingMsgId).catch(() => null);
          if (existingMsg) continue;
          clearXVerificationReviewMessageMeta(userId);
        }

        if (existingMsgId) continue; // posted elsewhere (transition-safe)

        const embed = buildXVerifyEmbed({
          user: { id: userId, username: profile.username || 'Unknown' },
          handle,
          code
        });
        const buttons = buildXVerifyButtons(userId, handle);

        const posted = await modApprovals.send({ embeds: [embed], components: buttons });
        setXVerificationReviewMessageMeta(userId, { channelId: posted.channel.id, messageId: posted.id });
      }
    }

    // 2) Top Caller candidates (highest value first; then keep stable order)
    const candidates = snapshot?.queues?.topCallerCandidates?.items || [];
    if (candidates.length) {
      for (const cand of candidates) {
        const userId = cand?.discordUserId ? String(cand.discordUserId) : '';
        if (!userId) continue;

        const profile = getUserProfileByDiscordId(userId);
        if (!profile) continue;

        const currentTrust = getCallerTrustLevel(userId);
        if (currentTrust === 'top_caller' || currentTrust === 'trusted_pro' || currentTrust === 'restricted') continue;

        const dismissedUntil = profile?.topCallerReview?.dismissedUntil;
        if (dismissedUntil && new Date(dismissedUntil).getTime() > Date.now()) continue;

        const reviewMeta = profile?.topCallerReview || {};
        const existingMsgId = String(reviewMeta.reviewMessageId || '');
        const existingChId = String(reviewMeta.reviewChannelId || '');

        if (existingMsgId && existingChId === String(modApprovals.id)) {
          const existingMsg = await modApprovals.messages.fetch(existingMsgId).catch(() => null);
          if (existingMsg) continue;
          clearTopCallerReviewMessageMeta(userId);
        }

        if (existingMsgId) continue;

        const report = getTopCallerEligibilityReport(userId);
        if (!report || report.eligibility !== 'YES') continue;

        const content = buildTopCallerCandidateContent({
          userId,
          trust: currentTrust,
          report
        });
        const buttons = buildTopCallerCandidateButtons(userId);

        const posted = await modApprovals.send({ content, components: buttons });
        setTopCallerReviewMessageMeta(userId, { channelId: posted.channel.id, messageId: posted.id });
      }
    }
  } catch (error) {
    console.error('[ModApprovals] Sync error:', error.message);
  }
}

async function refreshApprovalMessage(guild, contractAddress, forceLocked = false) {
  const trackedCall = getTrackedCall(contractAddress);
  if (!trackedCall || !trackedCall.approvalChannelId || !trackedCall.approvalMessageId) return;

  try {
    const channel = guild.channels.cache.get(trackedCall.approvalChannelId);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(trackedCall.approvalMessageId).catch(() => null);
    if (!message) return;

    const isLocked = forceLocked || trackedCall.approvalStatus !== 'pending';

    await message.edit({
      embeds: [buildApprovalStatusEmbed(trackedCall)],
      components: isLocked ? [] : buildApprovalButtons(contractAddress)
    });
  } catch (error) {
    console.error('[ApprovalQueue] Failed to refresh approval message:', error.message);
  }
}

function buildTagModal(contractAddress) {
  return new ModalBuilder()
    .setCustomId(`tag_modal:${contractAddress}`)
    .setTitle('Add Coin Tag')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('tag_input')
          .setLabel('Enter a tag')
          .setPlaceholder('e.g. rug, strong-chart, slop, x-worthy')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(40)
      )
    );
}

function buildNoteModal(contractAddress) {
  return new ModalBuilder()
    .setCustomId(`note_modal:${contractAddress}`)
    .setTitle('Add Coin Note')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('note_input')
          .setLabel('Enter a moderation note')
          .setPlaceholder('Why did you approve / deny / exclude this?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(300)
      )
    );
}

function buildXVerifyDenyModal(userId, handle) {
  return new ModalBuilder()
    .setCustomId(`xverify_deny_modal:${userId}:${handle}`)
    .setTitle('Deny X Verification')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('deny_reason')
          .setLabel('Reason for denial')
          .setPlaceholder('e.g. Could not find verification code on profile or recent posts')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(300)
      )
    );
}

async function handleDevSessionReply(message) {
  const session = getDevEditSession(message.author.id, message.channel.id);
  if (!session) return false;

  const content = message.content.trim();
  if (!content) return true;

  const trackedDev = getTrackedDev(session.walletAddress);

  if (!trackedDev) {
    clearDevEditSession(message.author.id, message.channel.id);
    await replyText(message, '❌ That dev no longer exists.');
    return true;
  }

  if (session.step === 'awaiting_menu_choice') {
    if (content === '1') {
      setDevEditSession(message.author.id, message.channel.id, {
        walletAddress: session.walletAddress,
        step: 'awaiting_new_nickname'
      });
      await replyText(message, '✏️ Reply with the new nickname.\nUse `none` to clear it.');
      return true;
    }

    if (content === '2') {
      setDevEditSession(message.author.id, message.channel.id, {
        walletAddress: session.walletAddress,
        step: 'awaiting_new_note'
      });
      await replyText(message, '📝 Reply with the new note.\nUse `none` to clear it.');
      return true;
    }

    if (content === '3') {
      setDevEditSession(message.author.id, message.channel.id, {
        walletAddress: session.walletAddress,
        step: 'awaiting_launch_ca'
      });
      await replyText(message, '🏆 Reply with the token CA you want to add from tracked calls.');
      return true;
    }

    if (content === '4') {
      if (!Array.isArray(trackedDev.previousLaunches) || trackedDev.previousLaunches.length === 0) {
        await replyText(message, '⚠️ This dev has no previous launches saved.');
        clearDevEditSession(message.author.id, message.channel.id);
        return true;
      }

      const launchList = trackedDev.previousLaunches
        .slice(0, 10)
        .map((launch, index) => `${index + 1}. ${launch.tokenName} (${launch.ticker})`)
        .join('\n');

      setDevEditSession(message.author.id, message.channel.id, {
        walletAddress: session.walletAddress,
        step: 'awaiting_remove_launch_index'
      });

      await replyText(
        message,
        `🗑️ Reply with the number of the launch to remove:\n\n${launchList}`
      );
      return true;
    }

    if (content === '5') {
      setDevEditSession(message.author.id, message.channel.id, {
        walletAddress: session.walletAddress,
        step: 'awaiting_delete_confirm'
      });
      await replyText(message, '⚠️ Type `DELETE` to permanently remove this dev.');
      return true;
    }

    if (content === '6') {
      clearDevEditSession(message.author.id, message.channel.id);
      await replyText(message, '✅ Edit session cancelled.');
      return true;
    }

    await replyText(message, '❌ Invalid option. Reply with `1`, `2`, `3`, `4`, `5`, or `6`.');
    return true;
  }

  if (session.step === 'awaiting_new_nickname') {
    const updated = updateTrackedDev(session.walletAddress, {
      nickname: content.toLowerCase() === 'none' ? '' : content
    });

    clearDevEditSession(message.author.id, message.channel.id);

    const embed = createDevCheckEmbed({
      walletAddress: session.walletAddress,
      trackedDev: updated,
      checkedBy: message.author.username,
      contextLabel: 'Nickname Updated',
      rankData: getDevRankData(updated)
    });

    await message.reply({
      embeds: [embed],
      allowedMentions: { repliedUser: false }
    });

    return true;
  }

  if (session.step === 'awaiting_new_note') {
    const updated = updateTrackedDev(session.walletAddress, {
      note: content.toLowerCase() === 'none' ? '' : content
    });

    clearDevEditSession(message.author.id, message.channel.id);

    const embed = createDevCheckEmbed({
      walletAddress: session.walletAddress,
      trackedDev: updated,
      checkedBy: message.author.username,
      contextLabel: 'Notes Updated',
      rankData: getDevRankData(updated)
    });

    await message.reply({
      embeds: [embed],
      allowedMentions: { repliedUser: false }
    });

    return true;
  }

  if (session.step === 'awaiting_launch_ca') {
    const tokenCa = extractSolanaAddress(content);

    if (!tokenCa || !isLikelySolWallet(tokenCa)) {
      await replyText(message, '❌ Invalid contract address. Try again.');
      return true;
    }

    const trackedCall = getTrackedCall(tokenCa);
    if (!trackedCall) {
      await replyText(message, '❌ That CA was not found in tracked calls.');
      return true;
    }

    const athMarketCap = Number(
      trackedCall.ath ||
      trackedCall.athMc ||
      trackedCall.athMarketCap ||
      trackedCall.latestMarketCap ||
      trackedCall.firstCalledMarketCap ||
      0
    );

    const firstCalledMarketCap = Number(trackedCall.firstCalledMarketCap || 0);

    let xFromCall = 0;
    if (firstCalledMarketCap > 0 && athMarketCap > 0) {
      xFromCall = Number((athMarketCap / firstCalledMarketCap).toFixed(2));
    }

    const launchEntry = {
      tokenName: trackedCall.tokenName || 'Unknown Token',
      ticker: trackedCall.ticker || 'UNKNOWN',
      contractAddress: trackedCall.contractAddress,
      athMarketCap,
      firstCalledMarketCap,
      xFromCall,
      discordMessageId: trackedCall.discordMessageId || null,
      addedAt: new Date().toISOString()
    };

    const updatedDev = addLaunchToTrackedDev(session.walletAddress, launchEntry);

    clearDevEditSession(message.author.id, message.channel.id);

    const embed = createDevLaunchAddedEmbed(updatedDev, launchEntry);

    await message.reply({
      embeds: [embed],
      allowedMentions: { repliedUser: false }
    });

    return true;
  }

  if (session.step === 'awaiting_remove_launch_index') {
    const index = Number(content);

    if (!Number.isInteger(index) || index < 1 || index > trackedDev.previousLaunches.length) {
      await replyText(message, '❌ Invalid number. Try again.');
      return true;
    }

    const selectedLaunch = trackedDev.previousLaunches[index - 1];
    const updated = removeLaunchFromTrackedDev(session.walletAddress, selectedLaunch.contractAddress);

    clearDevEditSession(message.author.id, message.channel.id);

    const embed = createDevCheckEmbed({
      walletAddress: session.walletAddress,
      trackedDev: updated,
      checkedBy: message.author.username,
      contextLabel: 'Launch Removed',
      rankData: getDevRankData(updated)
    });

    await message.reply({
      embeds: [embed],
      allowedMentions: { repliedUser: false }
    });

    return true;
  }

  if (session.step === 'awaiting_delete_confirm') {
    if (content !== 'DELETE') {
      await replyText(message, '❌ Delete cancelled. Type exactly `DELETE` if you want to remove this dev.');
      clearDevEditSession(message.author.id, message.channel.id);
      return true;
    }

    removeTrackedDev(session.walletAddress);
    clearDevEditSession(message.author.id, message.channel.id);

    await replyText(message, `🗑️ Dev removed:\n\`${session.walletAddress}\``);
    return true;
  }

  return false;
}

async function handleXVerificationReply(message) {
  const channelName = message.channel?.name || '';
  if (channelName !== X_VERIFY_CHANNEL_NAME) return false;

  if (message.author.bot) return true;

  upsertUserProfile({
    discordUserId: message.author.id,
    username: message.author.username,
    displayName: message.member?.displayName || message.author.globalName || message.author.username
  });

  return false;
}

async function ensureVerifyXPrompt(guild) {
  try {
    if (!guild) return;

    const verifyChannel = guild.channels.cache.find(ch => ch.name === X_VERIFY_CHANNEL_NAME);
    if (!verifyChannel || !verifyChannel.isTextBased()) return;

    const recentMessages = await verifyChannel.messages.fetch({ limit: 10 }).catch(() => null);
    if (!recentMessages) return;

    const existingBotPrompt = recentMessages.find(msg =>
      msg.author?.id === client.user.id &&
      msg.embeds?.[0]?.title === '🧪 Verify Your X Handle'
    );

    if (existingBotPrompt) return;

    await verifyChannel.send({
      embeds: [buildVerifyXChannelEmbed()],
      components: buildVerifyXChannelButtons()
    });
  } catch (error) {
    console.error('[VerifyX] Failed to ensure verify prompt:', error.message);
  }
}

client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const guilds = client.guilds.cache;
  const firstGuild = guilds.first();

  if (!firstGuild) {
    console.log('❌ No guild found for monitoring alerts.');
    return;
  }

  const botChannel = getBotCallsChannel(firstGuild);

if (!botChannel) {
  console.log('❌ Could not find #bot-calls channel.');
  return;
}

console.log(`📡 Alerts will post in: #${botChannel.name}`);

  const trackedDevs = getAllTrackedDevs();
  console.log(`[DevTracker] Loaded ${trackedDevs.length} tracked dev(s).`);

  if (SCANNER_ENABLED) {
  startMonitoring(botChannel, 60000);
  startAutoCallLoop(botChannel);
}

  await ensureVerifyXPrompt(firstGuild);

  logXMentionIngestionReadyDiagnostics();
  startXMentionIngestionScaffold(client);

  setInterval(() => {
    cleanupExpiredApprovals().catch(err => {
      console.error('[ApprovalQueue] Interval cleanup failed:', err.message);
    });
  }, 60 * 1000);

  setInterval(() => {
    syncModApprovalsChannel().catch(err => {
      console.error('[ModApprovals] Interval sync failed:', err.message);
    });
  }, 2 * 60 * 1000);

  setInterval(() => {
    cleanupResolvedModApprovals().catch(err => {
      console.error('[ModApprovals] Interval cleanup failed:', err.message);
    });
  }, 10 * 60 * 1000);
});

client.on('guildMemberAdd', (member) => {
  try {
    ensureUserProfileOnGuildJoin(member);
  } catch (err) {
    console.error('[UserProfiles] guildMemberAdd failed:', err.message);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isButton()) {
      const parts = interaction.customId.split(':');

      if (parts[0] === 'topcaller_approve' || parts[0] === 'topcaller_dismiss') {
        if (!interaction.member?.permissions?.has('ManageGuild')) {
          await interaction.reply({ content: '❌ Only mods/admins can use this action.', ephemeral: true });
          return;
        }

        const userId = parts[1];
        if (!userId) return;

        const profile = getUserProfileByDiscordId(userId);
        if (!profile) {
          await interaction.reply({ content: '❌ That user does not have a profile yet.', ephemeral: true });
          return;
        }

        const current = getCallerTrustLevel(userId);
        if (parts[0] === 'topcaller_approve') {
          if (current === 'top_caller') {
            await interaction.reply({ content: 'ℹ️ Already **top_caller**. No change.', ephemeral: true });
            return;
          }
          if (current === 'trusted_pro') {
            await interaction.reply({ content: '❌ **trusted_pro** is curated. This action does not override it.', ephemeral: true });
            return;
          }
          if (current === 'restricted') {
            await interaction.reply({ content: '❌ User is **restricted**. Resolve restriction first.', ephemeral: true });
            return;
          }

          const report = getTopCallerEligibilityReport(userId);
          if (!report || report.eligibility !== 'YES') {
            await interaction.reply({ content: '⚠️ Candidate no longer meets draft eligibility (**YES**) right now. No change.', ephemeral: true });
            return;
          }

          const updated = setCallerTrustLevel(userId, 'top_caller');
          if (!updated) {
            await interaction.reply({ content: '❌ Failed to update caller trust level.', ephemeral: true });
            return;
          }

          resolveTopCallerReview(userId);

          await interaction.update({
            content: [
              '✅ **Top Caller Approved**',
              `**User:** <@${userId}>`,
              `**Previous Trust:** \`${current}\``,
              `**New Trust:** \`top_caller\``,
              `**Approved by:** <@${interaction.user.id}>`,
              '',
              `**Valid Calls:** ${report.validCallCount}`,
              `**Avg X:** ${Number(report.avgX || 0).toFixed(2)}x`,
              `**Best Call:** ${Number(report.bestX || 0).toFixed(2)}x${report.bestToken ? ` — ${report.bestToken}` : ''}`
            ].join('\n'),
            components: []
          });
          return;
        }

        // Dismiss
        dismissTopCallerCandidate(userId, 7);

        await interaction.update({
          content: [
            '🗑 **Top Caller Candidate Dismissed**',
            `**User:** <@${userId}>`,
            `**Dismissed by:** <@${interaction.user.id}>`,
            `**Hidden for:** 7 days`,
            '',
            '_If they remain eligible after the cooldown, they can reappear._'
          ].join('\n'),
          components: []
        });
        return;
      }

      if (interaction.customId === 'profile_open_verify_modal') {
        await interaction.showModal(buildVerifyXHandleModal());
        return;
      }

      if (interaction.customId === 'xverify_submit_review') {
        const profile = getUserProfileByDiscordId(interaction.user.id);

        if (!profile) {
          await interaction.reply({
            content: '❌ No profile found for verification.',
            ephemeral: true
          });
          return;
        }

        const handle =
          profile?.xVerification?.requestedHandle ||
          profile?.xHandle ||
          '';

        const code =
          profile?.xVerification?.verificationCode ||
          '';

        if (!handle || !code) {
          await interaction.reply({
            content: '❌ No active X verification request found. Please start again.',
            ephemeral: true
          });
          return;
        }

        const embed = buildXVerifyEmbed({
  user: interaction.user,
  handle,
  code
});

const buttons = buildXVerifyButtons(interaction.user.id, handle);

        if (String(profile?.xVerification?.reviewMessageId || '')) {
          await interaction.update({
            content: `✅ Your verification request is already in the mod queue.\nA MOD will review and verify your request.`,
            components: []
          });
          return;
        }

        const modApprovals = getModApprovalsChannel(interaction.guild);
        const modChannel = getModChannel(interaction.guild);
        const xApprovalChannel = getXApprovalChannel(interaction.guild);

        let posted = null;

        // New primary: #mod-approvals. Transition-safe fallback: legacy channels if hub not present.
        if (modApprovals) {
          posted = await modApprovals.send({ embeds: [embed], components: buttons });
        } else {
          if (modChannel) {
            posted = await modChannel.send({ embeds: [embed], components: buttons });
          }
          if (xApprovalChannel && (!modChannel || xApprovalChannel.id !== modChannel.id)) {
            await xApprovalChannel.send({ embeds: [embed], components: buttons });
          }
        }

        if (posted) {
          setXVerificationReviewMessageMeta(interaction.user.id, {
            channelId: posted.channel.id,
            messageId: posted.id
          });
        }

        await interaction.update({
          content: `✅ Your verification request has been submitted.\nA MOD will review and verify your request.`,
          components: []
        });

        return;
      }

      if (parts[0] === 'profile_set_credit') {
        const mode = parts[1];

        const updated = setPublicCreditMode(interaction.user.id, mode);

        if (!updated) {
          await interaction.reply({
            content: '❌ Failed to update your profile setting.',
            ephemeral: true
          });
          return;
        }

        await interaction.update({
          embeds: [buildUserProfileEmbed(updated)],
          components: buildProfileButtons(updated)
        });

        return;
      }

      if (parts[0] === 'xverify_accept') {
  const userId = parts[1];
  const handle = parts[2];

  const profile = getUserProfileByDiscordId(userId);

  if (!profile || profile.isXVerified || profile.xVerification?.status !== 'pending') {
    await interaction.reply({
      content: 'This verification request has already been handled.',
      ephemeral: true
    });
    return;
  }

  completeXVerification(userId, handle);

  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (member) {
    await assignXVerifiedRole(member);
  }

  const verifyChannel = interaction.guild.channels.cache.find(
    ch => ch.name === X_VERIFY_CHANNEL_NAME
  );

  if (verifyChannel) {
    await verifyChannel.send(
      `✅ <@${userId}> has been verified as **@${handle}**`
    );
  }

  await interaction.update({
    content: [
      '✅ **X Verification Approved**',
      `**User:** <@${userId}>`,
      `**Handle:** @${handle}`,
      `**Approved by:** <@${interaction.user.id}>`
    ].join('\n'),
    embeds: [],
    components: []
  });

  return;
}

      if (parts[0] === 'xverify_deny') {
  const userId = parts[1];
  const handle = parts[2];

  const profile = getUserProfileByDiscordId(userId);

  if (!profile || profile.isXVerified || profile.xVerification?.status !== 'pending') {
    await interaction.reply({
      content: 'This verification request has already been handled.',
      ephemeral: true
    });
    return;
  }

  await interaction.showModal(buildXVerifyDenyModal(userId, handle));
  return;
}

      const [action, contractAddress] = interaction.customId.split(':');
      if (!action || !contractAddress) return;

      if (action === 'call_coin') {
        await interaction.deferReply({ ephemeral: false });

        await handleCallCommand(
          {
            ...interaction.message,
            author: interaction.user,
            member: interaction.member,
            channel: interaction.channel,
            guild: interaction.guild,
            reply: async (payload) => interaction.followUp({ ...payload, fetchReply: true })
          },
          contractAddress,
          'button'
        );

        try {
          await interaction.message.edit({
            components: []
          });
        } catch (_) {}

        return;
      }

      if (action === 'watch_coin') {
        await interaction.deferReply({ ephemeral: false });

        await handleWatchCommand(
          {
            ...interaction.message,
            author: interaction.user,
            member: interaction.member,
            channel: interaction.channel,
            guild: interaction.guild,
            reply: async (payload) => interaction.followUp({ ...payload, fetchReply: true })
          },
          contractAddress,
          'button'
        );

        try {
          await interaction.message.edit({
            components: []
          });
        } catch (_) {}

        return;
      }

      const trackedCall = getTrackedCall(contractAddress);
if (!trackedCall) {
  await interaction.reply({
    content: '❌ That tracked call could not be found.',
    ephemeral: true
  });
  return;
}

if (
  ['approve_call', 'deny_call', 'exclude_call'].includes(action) &&
  trackedCall.approvalStatus !== 'pending'
) {
  await interaction.reply({
    content: 'This approval request has already been handled.',
    ephemeral: true
  });
  return;
}

let updated = null;

      if (action === 'approve_call') {
        updated = setApprovalStatus(contractAddress, 'approved', {
  moderatedById: interaction.user.id,
  moderatedByUsername: interaction.user.username
});

        const xResult = await publishApprovedCoinToX(contractAddress);

        await refreshApprovalMessage(interaction.guild, contractAddress);

        let publishLine = '';
        if (xResult.success) {
          if (xResult.dryRun) {
            publishLine = `\n🧪 **X dry-run** (no live post) — would send **${xResult.milestoneX}x** as ${xResult.reply ? 'a reply' : 'an original'}`;
          } else {
            publishLine = xResult.reply
              ? `\n📤 Posted update reply to X at **${xResult.milestoneX}x**`
              : `\n📤 Posted original X thread at **${xResult.milestoneX}x**`;
          }
        } else {
          publishLine = `\n⚠️ X post not sent: \`${xResult.reason}\``;
        }

        await interaction.reply({
          content: `✅ Approved **${updated.tokenName || 'Unknown Token'}**${publishLine}\n\nWould you like to add tags or notes?`,
          components: buildModerationFollowupButtons(contractAddress),
          ephemeral: true
        });

        return;
      }

      if (action === 'deny_call') {
        updated = setApprovalStatus(contractAddress, 'denied', {
  moderatedById: interaction.user.id,
  moderatedByUsername: interaction.user.username
});

        await refreshApprovalMessage(interaction.guild, contractAddress);

        await interaction.reply({
          content: `❌ Denied **${updated.tokenName || 'Unknown Token'}**\n\nWould you like to add tags or notes?`,
          components: buildModerationFollowupButtons(contractAddress),
          ephemeral: true
        });

        return;
      }

      if (action === 'exclude_call') {
        updated = setApprovalStatus(contractAddress, 'excluded', {
  moderatedById: interaction.user.id,
  moderatedByUsername: interaction.user.username
});

        await refreshApprovalMessage(interaction.guild, contractAddress);

        await interaction.reply({
          content: `🗑 Excluded **${updated.tokenName || 'Unknown Token'}** from stats.\n\nWould you like to add tags or notes?`,
          components: buildModerationFollowupButtons(contractAddress),
          ephemeral: true
        });

        return;
      }

      if (action === 'tag_call') {
        await interaction.showModal(buildTagModal(contractAddress));
        return;
      }

      if (action === 'note_call') {
        await interaction.showModal(buildNoteModal(contractAddress));
        return;
      }

      if (action === 'done_call') {
        const latestTrackedCall = getTrackedCall(contractAddress);

        if (latestTrackedCall?.approvalStatus && latestTrackedCall.approvalStatus !== 'pending') {
          await deleteApprovalMessage(interaction.guild, latestTrackedCall);
          clearApprovalRequest(contractAddress);

          await interaction.update({
            content: '✅ Moderation complete. Removed from active review queue.',
            components: []
          });
        } else {
          await interaction.update({
            content: '⚠️ Please approve, deny, or exclude this coin before finishing.',
            components: buildModerationFollowupButtons(contractAddress)
          });
        }

        return;
      }
    }

    if (interaction.isModalSubmit()) {
      const parts = interaction.customId.split(':');

      if (interaction.customId === 'verify_x_handle_modal') {
        upsertUserProfile({
          discordUserId: interaction.user.id,
          username: interaction.user.username,
          displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username
        });

        const rawHandle = interaction.fields.getTextInputValue('x_handle_input');
        const handle = normalizeXHandle(rawHandle);

        if (!isLikelyXHandle(handle)) {
          await interaction.reply({
            content: '❌ Please enter a valid X handle.',
            ephemeral: true
          });
          return;
        }

        const code = generateVerificationCode(interaction.user.id, handle);

        startXVerification(interaction.user.id, handle, code);
        setXVerifySession(interaction.user.id, interaction.channel.id, {
          handle,
          code
        });

        await interaction.reply({
          content: [
            `🧪 To verify ownership of **@${handle}**:`,
            '',
            `**Option 1:** Add this code to your X bio`,
            `**Option 2:** Post a tweet containing this code`,
            '',
            `**Verification Code:** \`${code}\``,
            '',
            `When you're done, click **Submit for Review** below.`,
            `A MOD will review and verify your request.`
          ].join('\n'),
          components: buildXVerifySubmitButtons(),
          ephemeral: true
        });

        return;
      }

      if (parts[0] === 'xverify_deny_modal') {
  const userId = parts[1];
  const handle = parts[2];
  const reason = interaction.fields.getTextInputValue('deny_reason');

  const deniedProfile = denyXVerification(userId, handle, reason);

  if (!deniedProfile) {
    await interaction.reply({
      content: 'This verification request has already been handled.',
      ephemeral: true
    });
    return;
  }

  clearXVerifySessionsForUser(userId);

  const verifyChannel = interaction.guild.channels.cache.find(ch => ch.name === X_VERIFY_CHANNEL_NAME);
  if (verifyChannel) {
    await verifyChannel.send(`❌ <@${userId}>, your X verification for **@${handle}** was denied.\n**Reason:** ${reason}`);
  }

  await interaction.update({
    content: [
      '❌ **X Verification Denied**',
      `**User:** <@${userId}>`,
      `**Handle:** @${handle}`,
      `**Denied by:** <@${interaction.user.id}>`,
      reason && String(reason).trim() ? `**Reason:** ${String(reason).trim()}` : null
    ].filter(Boolean).join('\n'),
    embeds: [],
    components: []
  });
  return;
}

      const [action, contractAddress] = interaction.customId.split(':');
      if (!action || !contractAddress) return;

      const trackedCall = getTrackedCall(contractAddress);
      if (!trackedCall) {
        await interaction.reply({
          content: '❌ That tracked call could not be found.',
          ephemeral: true
        });
        return;
      }

      if (action === 'tag_modal') {
        const tag = interaction.fields.getTextInputValue('tag_input')?.trim();

        if (!tag) {
          await interaction.reply({
            content: '❌ Tag cannot be empty.',
            ephemeral: true
          });
          return;
        }

        addModerationTag(contractAddress, tag, {
          id: interaction.user.id,
          username: interaction.user.username
        });

        await refreshApprovalMessage(interaction.guild, contractAddress);

        await interaction.reply({
          content: `🏷 Added tag: \`${tag}\``,
          components: buildModerationFollowupButtons(contractAddress),
          ephemeral: true
        });

        return;
      }

      if (action === 'note_modal') {
        const note = interaction.fields.getTextInputValue('note_input')?.trim();

        if (!note) {
          await interaction.reply({
            content: '❌ Note cannot be empty.',
            ephemeral: true
          });
          return;
        }

        setModerationNotes(contractAddress, note, {
          id: interaction.user.id,
          username: interaction.user.username
        });

        await refreshApprovalMessage(interaction.guild, contractAddress);

        await interaction.reply({
          content: `📝 Note saved.`,
          components: buildModerationFollowupButtons(contractAddress),
          ephemeral: true
        });

        return;
      }
    }
  } catch (error) {
    console.error('[Interaction Error]', error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '❌ Something went wrong handling that interaction.',
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: '❌ Something went wrong handling that interaction.',
          ephemeral: true
        });
      }
    } catch (_) {}
  }
});

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;

    const content = message.content.trim();
    const lowerContent = content.toLowerCase();
    const channelName = message.channel?.name || '';

    upsertUserProfile({
      discordUserId: message.author.id,
      username: message.author.username,
      displayName: message.member?.displayName || message.author.globalName || message.author.username
    });

    const handledXVerify = await handleXVerificationReply(message);
    if (handledXVerify) return;

    const handledSession = await handleDevSessionReply(message);
    if (handledSession) return;

    if (content.startsWith('!')) {
      if (lowerContent === '!scanner') {
  if (!message.member?.permissions?.has('ManageGuild')) {
    await replyText(message, '❌ Mods/admins only.');
    return;
  }

  await replyText(
    message,
    SCANNER_ENABLED ? '🟢 Scanner is currently **ON**.' : '🔴 Scanner is currently **OFF**.'
  );
  return;
}

if (lowerContent === '!scanner on') {
  if (!message.member?.permissions?.has('ManageGuild')) {
    await replyText(message, '❌ Mods/admins only.');
    return;
  }

  if (SCANNER_ENABLED) {
    await replyText(message, '🟢 Scanner is already **ON**.');
    return;
  }

  SCANNER_ENABLED = true;
  BOT_SETTINGS.scannerEnabled = true;
saveBotSettings(BOT_SETTINGS);

  const botChannel = getBotCallsChannel(message.guild);

if (!botChannel) {
  await replyText(message, '❌ Could not find #bot-calls channel.');
  return;
}

startMonitoring(botChannel, 60000);
startAutoCallLoop(botChannel);

  await replyText(message, '🟢 Scanner **ENABLED** (monitor + auto-call running).');
  return;
}

if (lowerContent === '!scanner off') {
  if (!message.member?.permissions?.has('ManageGuild')) {
    await replyText(message, '❌ Mods/admins only.');
    return;
  }

  if (!SCANNER_ENABLED) {
    await replyText(message, '🔴 Scanner is already **OFF**.');
    return;
  }

  SCANNER_ENABLED = false;
  BOT_SETTINGS.scannerEnabled = false;
saveBotSettings(BOT_SETTINGS);

  stopMonitoring();
  stopAutoCallLoop();

  await replyText(message, '🔴 Scanner **DISABLED** (all loops stopped).');
  return;
}
      if (lowerContent === '!testx') {
        const result = await createPost('Test post from McGBot 🚀');

        if (result.success) {
          if (result.dryRun) {
            await replyText(
              message,
              '🧪 **X dry-run** — live API skipped (`X_POST_DRY_RUN` / `X_POST_PREVIEW`).'
            );
          } else {
            await replyText(message, `✅ Posted to X\nPost ID: ${result.id}`);
          }
        } else {
          await replyText(message, `❌ Failed to post to X\n${JSON.stringify(result.error, null, 2)}`);
        }

        return;
      }

      if (lowerContent.startsWith('!xpostpreview')) {
        if (message.author.id !== process.env.BOT_OWNER_ID) {
          await replyText(message, '❌ Only the bot owner can use this command.');
          return;
        }

        const rest = content.slice('!xpostpreview'.length).trim();
        const parts = rest.split(/\s+/).filter(Boolean);

        if (!parts.length) {
          await replyText(
            message,
            '❌ Usage: `!xpostpreview <contract> [optionalMilestoneX]` — preview milestone X copy (no API).'
          );
          return;
        }

        const ca = parts[0];
        if (!isLikelySolanaCA(ca)) {
          await replyText(message, '❌ That does not look like a Solana contract address.');
          return;
        }

        let forceMilestoneX = null;
        if (parts[1] != null) {
          const m = Number(parts[1]);
          if (!Number.isFinite(m) || m < 1) {
            await replyText(message, '❌ Optional milestone must be a number ≥ 1.');
            return;
          }
          forceMilestoneX = m;
        }

        const tc = getTrackedCall(ca);
        if (!tc) {
          await replyText(message, '❌ No tracked call for that contract.');
          return;
        }

        const info = describeXPostForTrackedCall(tc, { forceMilestoneX });

        const embed = new EmbedBuilder()
          .setColor(0x1d9bf0)
          .setTitle(`X milestone preview — ${info.tokenName || 'Unknown'} ($${info.ticker || '?'})`)
          .addFields(
            {
              name: 'Post kind',
              value:
                info.postKind === 'reply'
                  ? `Reply (in_reply_to_tweet_id = **xOriginalPostId**)\n\`${info.replyToTweetId || 'missing — would be original'}\``
                  : 'Original tweet (no xOriginalPostId yet)',
              inline: false
            },
            {
              name: 'Milestone / state',
              value: [
                `ATH multiple: **${info.currentAthMultiple.toFixed(2)}x**`,
                `Preview milestone: **${info.milestoneX || '—'}x**`,
                `xApproved: **${info.xApproved ? 'yes' : 'no'}**`,
                `This rung already in xPostedMilestones: **${info.alreadyPostedThisMilestone ? 'yes' : 'no'}**`,
                `Posted rungs: ${info.postedMilestones.length ? info.postedMilestones.map(x => `${x}x`).join(', ') : 'none'}`,
                `Trigger X: **${info.approvalTriggerX}x** · Ladder: \`${info.ladder.join(', ')}\``
              ].join('\n'),
              inline: false
            },
            {
              name: 'Caller credit (approval path)',
              value: info.callerCreditApproval.slice(0, 1024) || '—',
              inline: true
            },
            {
              name: 'Caller credit (monitor path)',
              value: info.callerCreditMonitor.slice(0, 1024) || '—',
              inline: true
            },
            {
              name: 'Threading',
              value: info.threading.explanation.slice(0, 1024),
              inline: false
            },
            {
              name: 'Chart attachment (milestone posts)',
              value:
                `Env **X_MILESTONE_CHART_ENABLED**: ${info.milestoneChartAttachmentEnabled ? 'on' : 'off'}\n` +
                `QuickChart spec buildable: **${info.chartSpecCanBuild ? 'yes' : 'no'}** (needs ATH MC)`,
              inline: false
            }
          )
          .setFooter({
            text: `Live posting blocked when env dry-run is ON: ${info.dryRunEnvActive ? 'yes' : 'no'}`
          });

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        const escFence = (s) => String(s || '').replace(/```/g, '`\u200b``');
        const sendBodyChunks = async (label, body) => {
          const text = body || '(no body — no eligible milestone for preview)';
          const limit = 1800;
          const chunks = [];
          for (let i = 0; i < text.length; i += limit) {
            chunks.push(text.slice(i, i + limit));
          }
          let n = 0;
          for (const chunk of chunks) {
            n += 1;
            const suffix = chunks.length > 1 ? ` (${n}/${chunks.length})` : '';
            await message.channel.send({
              content: `**${label}${suffix}**\n\`\`\`\n${escFence(chunk)}\n\`\`\``,
              allowedMentions: { parse: [] }
            });
          }
        };

        await sendBodyChunks('Body — mod approval (index.js)', info.bodyApprovalTemplate);
        await sendBodyChunks('Body — monitor auto-post (monitoringEngine)', info.bodyMonitorTemplate);

        return;
      }

      if (lowerContent.startsWith('!profile') || lowerContent === '!myprofile') {
        const mentionedUser = message.mentions.users.first();

        let targetUser = message.author;

        // If mention exists → viewing someone else's profile
        if (mentionedUser) {
          targetUser = mentionedUser;
        }

        let profile = getUserProfileByDiscordId(targetUser.id);

        if (!profile) {
          profile = upsertUserProfile({
            discordUserId: targetUser.id,
            username: targetUser.username,
            displayName:
              message.guild?.members?.cache?.get(targetUser.id)?.displayName ||
              targetUser.globalName ||
              targetUser.username
          });
        }

        const isOwnProfile = targetUser.id === message.author.id;

        await message.reply({
          embeds: [buildUserProfileEmbed(profile)],
          components: isOwnProfile ? buildProfileButtons(profile) : [],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (lowerContent.startsWith('!credit ')) {
        const modeInput = content.replace(/^!credit\s+/i, '').trim().toLowerCase();

        let mode = null;
        if (modeInput === 'anonymous') mode = 'anonymous';
        if (modeInput === 'discord') mode = 'discord_name';
        if (modeInput === 'xtag') mode = 'verified_x_tag';

        if (!mode) {
          await replyText(message, '❌ Usage: `!credit anonymous`, `!credit discord`, or `!credit xtag`');
          return;
        }

        const profile = getUserProfileByDiscordId(message.author.id);

        if (!profile) {
          await replyText(message, '❌ No profile found yet.');
          return;
        }

        if (mode === 'verified_x_tag' && !profile.isXVerified) {
          await replyText(
            message,
            `❌ You do not have a verified X handle yet.\nUse **#${X_VERIFY_CHANNEL_NAME}** or **!myprofile** first.`
          );
          return;
        }

        const updated = setPublicCreditMode(message.author.id, mode);

        if (!updated) {
          await replyText(message, '❌ Failed to update your credit preference.');
          return;
        }

        await message.reply({
          embeds: [buildUserProfileEmbed(updated)],
          components: buildProfileButtons(updated),
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (lowerContent.startsWith('!getcallertrust')) {
        if (!message.member?.permissions?.has('ManageGuild')) {
          await replyText(message, '❌ Only mods/admins can use this command.');
          return;
        }

        const userId = parseMentionedUserIdFromContent(message);
        if (!userId) {
          await replyText(message, '❌ Usage: `!getcallertrust @user`');
          return;
        }

        const profile = getUserProfileByDiscordId(userId);
        if (!profile) {
          await replyText(message, '❌ That user does not have a profile yet.');
          return;
        }

        const level = getCallerTrustLevel(userId);
        await replyText(
          message,
          `🪪 Caller trust for <@${userId}>: **${level}**`
        );
        return;
      }

      if (lowerContent.startsWith('!setcallertrust ')) {
        if (!message.member?.permissions?.has('ManageGuild')) {
          await replyText(message, '❌ Only mods/admins can use this command.');
          return;
        }

        const userId = parseMentionedUserIdFromContent(message);
        if (!userId) {
          await replyText(
            message,
            '❌ Usage: `!setcallertrust @user <level>`\n' +
              `Allowed: \`${CALLER_TRUST_LEVELS.join('`, `')}\``
          );
          return;
        }

        const rawLevel = content
          .replace(/^!setcallertrust\\s+/i, '')
          .replace(/<@!?(\\d+)>/, '')
          .trim()
          .split(/\\s+/)[0];

        const level = normalizeCallerTrustLevel(rawLevel);
        if (!rawLevel || level === 'none' && String(rawLevel).trim().toLowerCase() !== 'none') {
          await replyText(
            message,
            '❌ Invalid trust level.\n' +
              `Allowed: \`${CALLER_TRUST_LEVELS.join('`, `')}\``
          );
          return;
        }

        const existing = getUserProfileByDiscordId(userId);
        if (!existing) {
          await replyText(message, '❌ That user does not have a profile yet.');
          return;
        }

        const updated = setCallerTrustLevel(userId, level);
        if (!updated) {
          await replyText(message, '❌ Failed to update caller trust level.');
          return;
        }

        await replyText(
          message,
          `✅ Updated caller trust for <@${userId}>: **${existing.callerTrustLevel || 'none'}** → **${level}**`
        );
        return;
      }

      if (lowerContent.startsWith('!topcallercheck')) {
        if (!message.member?.permissions?.has('ManageGuild')) {
          await replyText(message, '❌ Only mods/admins can use this command.');
          return;
        }

        const userId = parseMentionedUserIdFromContent(message);
        if (!userId) {
          await replyText(message, '❌ Usage: `!topcallercheck @user`');
          return;
        }

        const report = getTopCallerEligibilityReport(userId);
        if (!report) {
          await replyText(message, '❌ Could not evaluate (missing user id).');
          return;
        }

        const trust = getCallerTrustLevel(userId);
        const top3Lines = (report.top3 || [])
          .map(
            (t, i) =>
              `${i + 1}. **${t.tokenName || '?'}** (${t.ticker || '—'}) — **${Number(t.x).toFixed(2)}x**`
          )
          .join('\n');

        const reasonBlock = (report.reasons || []).map(r => `• ${r}`).join('\n') || '• (no extra notes)';

        await replyText(
          message,
          [
            `📊 **Top Caller Check** — <@${userId}>`,
            `**Current trust:** \`${trust}\` _(manual / separate from this tool)_`,
            '',
            `**Scope:** Discord-ID-linked \`user_call\` rows only (same validity rules as caller stats).`,
            `**Draft thresholds:** min **${TOP_CALLER_ELIGIBILITY.minValidCalls}** valid calls, avg X ≥ **${TOP_CALLER_ELIGIBILITY.minAvgX}x** (borderline / NO uses softer floors).`,
            '',
            `**Valid calls:** ${report.validCallCount}`,
            `**Avg X:** ${report.avgX.toFixed(2)}x`,
            `**Median X:** ${report.medianX.toFixed(2)}x`,
            `**Best X:** ${report.bestX.toFixed(2)}x${report.bestToken ? ` — ${report.bestToken}` : ''}`,
            top3Lines ? `\n**Top 3 calls:**\n${top3Lines}` : '',
            '',
            `**Excluded from stats (same ID):** ${report.excludedFromStatsCount}`,
            `**Denied / excluded / expired approval (same ID):** ${report.blockedByApprovalCount}`,
            `**Total user_call rows for this ID:** ${report.idLinkedCallCount}`,
            '',
            `**Eligible (draft):** **${report.eligibility}**`,
            '',
            '**Notes:**',
            reasonBlock,
            '',
            '_Read-only — does not change trust or roles._'
          ]
            .filter(Boolean)
            .join('\n')
        );
        return;
      }

      if (lowerContent.startsWith('!approvetopcaller')) {
        if (!message.member?.permissions?.has('ManageGuild')) {
          await replyText(message, '❌ Only mods/admins can use this command.');
          return;
        }

        const userId = parseMentionedUserIdFromContent(message);
        if (!userId) {
          await replyText(message, '❌ Usage: `!approvetopcaller @user`');
          return;
        }

        const existing = getUserProfileByDiscordId(userId);
        if (!existing) {
          await replyText(message, '❌ That user does not have a profile yet.');
          return;
        }

        const current = getCallerTrustLevel(userId);
        if (current === 'top_caller') {
          await replyText(
            message,
            `ℹ️ <@${userId}> is already **top_caller**. No change.`
          );
          return;
        }
        if (current === 'trusted_pro') {
          await replyText(
            message,
            '❌ **trusted_pro** is a separate curated tier. This command only sets **top_caller** and would replace that value.\n' +
              'Use `!setcallertrust` if you need to change **trusted_pro** or combine tiers manually.'
          );
          return;
        }
        if (current === 'restricted') {
          await replyText(
            message,
            '❌ User is **restricted**. Resolve trust with `!setcallertrust` before using Top Caller promotion.'
          );
          return;
        }

        const updated = setCallerTrustLevel(userId, 'top_caller');
        if (!updated) {
          await replyText(message, '❌ Failed to update caller trust level.');
          return;
        }

        const draftReport = getTopCallerEligibilityReport(userId);
        const draftLine = draftReport
          ? `_Draft \`!topcallercheck\`: **${draftReport.eligibility}**_`
          : '';

        await replyText(
          message,
          [
            `✅ **top_caller** granted to <@${userId}> (was \`${current}\`).`,
            draftLine,
            '_Does not assign Discord roles — trust field only._'
          ]
            .filter(Boolean)
            .join('\n')
        );
        return;
      }

      if (lowerContent.startsWith('!removetopcaller')) {
        if (!message.member?.permissions?.has('ManageGuild')) {
          await replyText(message, '❌ Only mods/admins can use this command.');
          return;
        }

        const userId = parseMentionedUserIdFromContent(message);
        if (!userId) {
          await replyText(message, '❌ Usage: `!removetopcaller @user`');
          return;
        }

        const existing = getUserProfileByDiscordId(userId);
        if (!existing) {
          await replyText(message, '❌ That user does not have a profile yet.');
          return;
        }

        const current = getCallerTrustLevel(userId);
        if (current !== 'top_caller') {
          await replyText(
            message,
            `ℹ️ <@${userId}> is not **top_caller** (current: **${current}**). No change.`
          );
          return;
        }

        const updatedCaller = setCallerTrustLevel(userId, 'approved');
        if (!updatedCaller) {
          await replyText(message, '❌ Failed to update caller trust level.');
          return;
        }

        const draftReport = getTopCallerEligibilityReport(userId);
        const draftLine = draftReport
          ? `_Draft \`!topcallercheck\` would now read: **${draftReport.eligibility}**_`
          : '';

        await replyText(
          message,
          [
            `✅ Removed **top_caller** from <@${userId}> → **approved** (standard caller trust, not a full reset).`,
            draftLine,
            '_trusted_pro and other tiers were not involved._'
          ]
            .filter(Boolean)
            .join('\n')
        );
        return;
      }

      if (lowerContent.startsWith('!verifyx ')) {
        if (!message.member?.permissions?.has('ManageGuild')) {
          await replyText(message, '❌ You need **Manage Server** permission to use this command.');
          return;
        }

        const mentionedUser = message.mentions.users.first();
        if (!mentionedUser) {
          await replyText(message, '❌ Usage: `!verifyx @user`');
          return;
        }

        const targetProfile = getUserProfileByDiscordId(mentionedUser.id);
        if (!targetProfile) {
          await replyText(message, '❌ That user does not have a profile yet.');
          return;
        }

        const pendingHandle =
          targetProfile?.xVerification?.requestedHandle ||
          targetProfile?.xHandle ||
          '';

        if (!pendingHandle) {
          await replyText(message, '❌ That user does not have a pending X verification request.');
          return;
        }

        completeXVerification(mentionedUser.id, pendingHandle);

        const member = await message.guild.members.fetch(mentionedUser.id).catch(() => null);
        if (member) {
          await assignXVerifiedRole(member);
        }

        const verifyChannel = message.guild.channels.cache.find(
          ch => ch.name === X_VERIFY_CHANNEL_NAME
        );

        if (verifyChannel) {
          await verifyChannel.send(
            `✅ <@${mentionedUser.id}> has been verified as **@${pendingHandle}**`
          );
        }

        await replyText(
          message,
          `✅ Verified **${mentionedUser.username}** as **@${pendingHandle}**${member ? ` and assigned **${X_VERIFIED_ROLE_NAME}**.` : '.'}`
        );

        return;
      }

      if (lowerContent === '!devleaderboard') {
        const leaderboard = getDevLeaderboard(10);
        const embed = createDevLeaderboardEmbed(leaderboard);

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }
if (lowerContent.startsWith('!resetstats')) {
        const mentionedUser = message.mentions.users.first();
        const isModOrAdmin = message.member?.permissions?.has('ManageGuild');

        let targetUser = message.author;

        if (mentionedUser) {
          if (!isModOrAdmin) {
            await replyText(message, '❌ Only mods/admins can reset another user’s stats.');
            return;
          }

          targetUser = mentionedUser;
        }

        const targetProfile = upsertUserProfile({
          discordUserId: targetUser.id,
          username: targetUser.username,
          displayName:
            message.guild?.members?.cache?.get(targetUser.id)?.displayName ||
            targetUser.globalName ||
            targetUser.username
        });

        const result = excludeTrackedCallsFromStatsByCaller(
          {
            discordUserId: targetProfile.discordUserId,
            username: targetProfile.username,
            displayName: targetProfile.displayName
          },
          {
            resetById: message.author.id,
            resetByUsername: message.author.username,
            resetReason:
              targetUser.id === message.author.id
                ? 'Self-requested stats reset'
                : `Admin/mod reset by ${message.author.username}`
          }
        );

        if (!result?.updatedCount) {
          await replyText(
            message,
            targetUser.id === message.author.id
              ? '❌ No tracked user-call stats found to reset for your account.'
              : `❌ No tracked user-call stats found to reset for **${targetProfile.displayName || targetProfile.username}**.`
          );
          return;
        }

        await replyText(
          message,
          targetUser.id === message.author.id
            ? `✅ Reset **${result.updatedCount}** of your tracked user-call stat entr${result.updatedCount === 1 ? 'y' : 'ies'}.`
            : `✅ Reset **${result.updatedCount}** tracked user-call stat entr${result.updatedCount === 1 ? 'y' : 'ies'} for **${targetProfile.displayName || targetProfile.username}**.`
        );

        return;
      }

if (lowerContent.startsWith('!setminmc ')) {
  if (message.author.id !== process.env.BOT_OWNER_ID) {
    await replyText(message, '❌ Only the bot owner can use this command.');
    return;
  }

  const parts = content.split(/\s+/);
  const value = Number(parts[1]);

  if (!Number.isFinite(value) || value < 0) {
    await replyText(message, '❌ Usage: `!setminmc <number>`');
    return;
  }

  const ok = updateScannerSetting('minMarketCap', value);

  if (!ok) {
    await replyText(message, '❌ Failed to update scanner setting.');
    return;
  }

  await replyText(message, `✅ Min Market Cap updated to **${value.toLocaleString()}**.`);
  return;
}
if (lowerContent.startsWith('!setminliq ')) {
  if (message.author.id !== process.env.BOT_OWNER_ID) {
    await replyText(message, '❌ Only the bot owner can use this command.');
    return;
  }

  const value = Number(content.split(/\s+/)[1]);

  if (!Number.isFinite(value) || value < 0) {
    await replyText(message, '❌ Usage: `!setminliq <number>`');
    return;
  }

  updateScannerSetting('minLiquidity', value);

  await replyText(message, `✅ Min Liquidity updated to **${value.toLocaleString()}**.`);
  return;
}

if (lowerContent.startsWith('!setminvol5m ')) {
  if (message.author.id !== process.env.BOT_OWNER_ID) {
    await replyText(message, '❌ Only the bot owner can use this command.');
    return;
  }

  const value = Number(content.split(/\s+/)[1]);

  if (!Number.isFinite(value) || value < 0) {
    await replyText(message, '❌ Usage: `!setminvol5m <number>`');
    return;
  }

  updateScannerSetting('minVolume5m', value);

  await replyText(message, `✅ Min 5m Volume updated to **${value.toLocaleString()}**.`);
  return;
}

if (lowerContent.startsWith('!setminvol1h ')) {
  if (message.author.id !== process.env.BOT_OWNER_ID) {
    await replyText(message, '❌ Only the bot owner can use this command.');
    return;
  }

  const value = Number(content.split(/\s+/)[1]);

  if (!Number.isFinite(value) || value < 0) {
    await replyText(message, '❌ Usage: `!setminvol1h <number>`');
    return;
  }

  updateScannerSetting('minVolume1h', value);

  await replyText(message, `✅ Min 1h Volume updated to **${value.toLocaleString()}**.`);
  return;
}

if (lowerContent.startsWith('!setmintxns5m ')) {
  if (message.author.id !== process.env.BOT_OWNER_ID) {
    await replyText(message, '❌ Only the bot owner can use this command.');
    return;
  }

  const value = Number(content.split(/\s+/)[1]);

  if (!Number.isFinite(value) || value < 0) {
    await replyText(message, '❌ Usage: `!setmintxns5m <number>`');
    return;
  }

  updateScannerSetting('minTxns5m', value);

  await replyText(message, `✅ Min 5m Txns updated to **${value.toLocaleString()}**.`);
  return;
}

if (lowerContent.startsWith('!setmintxns1h ')) {
  if (message.author.id !== process.env.BOT_OWNER_ID) {
    await replyText(message, '❌ Only the bot owner can use this command.');
    return;
  }

  const value = Number(content.split(/\s+/)[1]);

  if (!Number.isFinite(value) || value < 0) {
    await replyText(message, '❌ Usage: `!setmintxns1h <number>`');
    return;
  }

  updateScannerSetting('minTxns1h', value);

  await replyText(message, `✅ Min 1h Txns updated to **${value.toLocaleString()}**.`);
  return;
}

if (lowerContent.startsWith('!setapprovalx ')) {
  if (message.author.id !== process.env.BOT_OWNER_ID) {
    await replyText(message, '❌ Only the bot owner can use this command.');
    return;
  }

  const value = Number(content.split(/\s+/)[1]);

  if (!Number.isFinite(value) || value < 1) {
    await replyText(message, '❌ Usage: `!setapprovalx <number>`');
    return;
  }

  updateScannerSetting('approvalTriggerX', value);
  updateScannerSetting('approvalMilestoneLadder', []);

  await replyText(message, `✅ Approval Trigger updated to **${value}x**.`);
  return;
}
if (lowerContent.startsWith('!setapprovalladder ')) {
  if (message.author.id !== process.env.BOT_OWNER_ID) {
    await replyText(message, '❌ Only the bot owner can use this command.');
    return;
  }

  const rawInput = content.slice('!setapprovalladder '.length).trim();

  if (!rawInput) {
    await replyText(message, '❌ Usage: `!setapprovalladder 3,5,8,12,20,30,50,74,100`');
    return;
  }

  const ladder = rawInput
    .split(',')
    .map(x => Number(x.trim()))
    .filter(x => Number.isFinite(x) && x >= 1);

  const uniqueSorted = [...new Set(ladder)].sort((a, b) => a - b);

  if (!uniqueSorted.length) {
    await replyText(message, '❌ No valid milestone values found.');
    return;
  }

  const ok1 = updateScannerSetting('approvalMilestoneLadder', uniqueSorted);
  const ok2 = updateScannerSetting('approvalTriggerX', uniqueSorted[0]);

  if (!ok1 || !ok2) {
    await replyText(message, '❌ Failed to update approval ladder.');
    return;
  }

  await replyText(
    message,
    `✅ Approval milestone ladder updated to **${uniqueSorted.join(', ')}x**\n` +
    `🎯 First trigger automatically set to **${uniqueSorted[0]}x**`
  );
  return;
}

if (lowerContent.startsWith('!setsanityminmc ')) {
  if (message.author.id !== process.env.BOT_OWNER_ID) {
    await replyText(message, '❌ Only the bot owner can use this command.');
    return;
  }

  const value = Number(content.split(/\s+/)[1]);

  if (!Number.isFinite(value) || value < 0) {
    await replyText(message, '❌ Usage: `!setsanityminmc <number>`');
    return;
  }

  updateScannerSetting('sanityMinMeaningfulMarketCap', value);

  await replyText(message, `✅ Sanity Min MC updated to **${value.toLocaleString()}**.`);
  return;
}

if (lowerContent.startsWith('!setsanityminliq ')) {
  if (message.author.id !== process.env.BOT_OWNER_ID) {
    await replyText(message, '❌ Only the bot owner can use this command.');
    return;
  }

  const value = Number(content.split(/\s+/)[1]);

  if (!Number.isFinite(value) || value < 0) {
    await replyText(message, '❌ Usage: `!setsanityminliq <number>`');
    return;
  }

  updateScannerSetting('sanityMinMeaningfulLiquidity', value);

  await replyText(message, `✅ Sanity Min Liquidity updated to **${value.toLocaleString()}**.`);
  return;
}

if (lowerContent.startsWith('!setsanityminliqratio ')) {
  if (message.author.id !== process.env.BOT_OWNER_ID) {
    await replyText(message, '❌ Only the bot owner can use this command.');
    return;
  }

  const value = Number(content.split(/\s+/)[1]);

  if (!Number.isFinite(value) || value < 0) {
    await replyText(message, '❌ Usage: `!setsanityminliqratio <number>`');
    return;
  }

  updateScannerSetting('sanityMinLiquidityToMarketCapRatio', value);

  await replyText(message, `✅ Min Liq/MC ratio updated to **${value}**.`);
  return;
}

if (lowerContent.startsWith('!setsanitymaxliqratio ')) {
  if (message.author.id !== process.env.BOT_OWNER_ID) {
    await replyText(message, '❌ Only the bot owner can use this command.');
    return;
  }

  const value = Number(content.split(/\s+/)[1]);

  if (!Number.isFinite(value) || value <= 0) {
    await replyText(message, '❌ Usage: `!setsanitymaxliqratio <number>`');
    return;
  }

  updateScannerSetting('sanityMaxLiquidityToMarketCapRatio', value);

  await replyText(message, `✅ Max Liq/MC ratio updated to **${value}**.`);
  return;
}

if (lowerContent.startsWith('!setsanitymaxratio5m ')) {
  if (message.author.id !== process.env.BOT_OWNER_ID) {
    await replyText(message, '❌ Only the bot owner can use this command.');
    return;
  }

  const value = Number(content.split(/\s+/)[1]);

  if (!Number.isFinite(value) || value <= 0) {
    await replyText(message, '❌ Usage: `!setsanitymaxratio5m <number>`');
    return;
  }

  updateScannerSetting('sanityMaxBuySellRatio5m', value);

  await replyText(message, `✅ Max 5m Buy/Sell ratio updated to **${value}**.`);
  return;
}

if (lowerContent.startsWith('!setsanitymaxratio1h ')) {
  if (message.author.id !== process.env.BOT_OWNER_ID) {
    await replyText(message, '❌ Only the bot owner can use this command.');
    return;
  }

  const value = Number(content.split(/\s+/)[1]);

  if (!Number.isFinite(value) || value <= 0) {
    await replyText(message, '❌ Usage: `!setsanitymaxratio1h <number>`');
    return;
  }

  updateScannerSetting('sanityMaxBuySellRatio1h', value);

  await replyText(message, `✅ Max 1h Buy/Sell ratio updated to **${value}**.`);
  return;
}

if (lowerContent === '!commands' || lowerContent === '!help') {
  const isModOrAdmin = message.member?.permissions?.has('ManageGuild');
  const isOwner = message.author.id === process.env.BOT_OWNER_ID;

  let contentOut = `📘 **McGBot Command List**\n\n`;

  // USER COMMANDS
  contentOut +=
    `👤 **User Commands**\n` +
    `• \`!help\` / \`!commands\` — This list\n` +
    `• \`!ping\` — Quick alive check\n` +
    `• \`!status\` — Bot status\n` +
    `• \`!ca <ca>\` — Compact contract intel (no tracking)\n` +
    `• \`!scan\` — Random scanner-style test\n` +
    `• \`!scan <ca>\` — Deep scan a token (no tracking)\n` +
    `• \`!call <ca>\` — Official call + track\n` +
    `• \`!procall <ca> | <title> | <why> | <risk?>\` — Trusted Pro call (**trusted_pro only**)\n` +
    `• \`!watch <ca>\` — Track without caller credit\n` +
    `• \`!tracked\` / \`!tracked <ca>\` — Tracked summary or detail (live refresh)\n` +
    `• \`!caller <name>\` or \`!caller @user\` — Caller stats (embed)\n` +
    `• \`!callerboard\` — Top callers (embed)\n` +
    `• \`!botstats\` — McGBot aggregate stats\n` +
    `• \`!profile\` / \`!myprofile\` — Your caller profile (+ Verify X button)\n` +
    `• \`!credit anonymous\` / \`discord\` / \`xtag\` — Public credit label on calls\n` +
    `• \`!resetstats\` — Reset your tracked stat flags (mods: \`!resetstats @user\`)\n` +
    `• **X verification:** use **#verify-x** or **!profile → Verify X** (not a user \`!verifyx\` text command)\n` +
    `• \`!bestcall24h\` / \`!bestcallweek\` / \`!bestcallmonth\` — Best user call windows\n` +
    `• \`!topcaller24h\` / \`!topcallerweek\` / \`!topcallermonth\` — Top caller windows\n` +
    `• \`!bestbot24h\` / \`!bestbotweek\` / \`!bestbotmonth\` — Best bot call windows\n` +
    `• \`!devleaderboard\` — Dev leaderboard (embed)\n` +
    `• \`!addlaunch <dev_wallet> <token_ca>\` — Log a launch on a tracked dev\n` +
    `• \`!testreal <ca>\` — Live provider / token test (embed)\n` +
    `• \`!autoscantest\` [conservative|balanced|aggressive] — Simulated auto alerts\n` +
    `• \`!testx\` — Post a test tweet *(no extra bot permission check — rely on channel access)*\n\n`;

  // MOD COMMANDS (Manage Server — bot owner always sees this block too)
  if (isModOrAdmin || isOwner) {
    contentOut +=
      `🛡️ **Mod / Manage Server**\n` +
      `• Approval buttons in **#coin-approval** / mod flows\n` +
      `• \`!approvalstats\` — Approval queue counts\n` +
      `• \`!pendingapprovals\` — Pending X verifications + top pending **bot** approvals\n` +
      `• \`!recentcalls\` — Recent bot-tracked calls\n` +
      `• \`!monitorstatus\` — Active / archived / pending / scanner state\n` +
      `• \`!scanner\` — Show whether scanner is ON or OFF\n` +
      `• \`!scanner on\` / \`!scanner off\` — Start or stop scanner + monitor + auto-call\n` +
      `• \`!verifyx @user\` — Approve a member’s pending X verification (requires **Manage Server**)\n` +
      `• \`!resetbotstats\` — Reset bot-call stat exclusions on tracked data\n` +
      `• \`!backfillprofiles\` — Preview members missing bot profiles; \`!backfillprofiles run\` creates them once\n` +
      `• \`!testxintake\` — Simulate X mention intake (dry-run); owner \`apply\` for real write (**tweet text must include \`#call\`**)\n` +
      `• \`!testxmention\` — Inject fake mention through **ingestion scaffold** (dry-run); owner \`apply\` + reply step (**needs \`#call\`**)\n` +
      `• \`!resetmonitor\` — **Destructive:** clear all tracked coins, stop scanner & loops\n` +
      `• \`!truestats @user\` — Caller stats including reset/excluded calls\n` +
      `• \`!truebotstats\` — Bot stats including reset/excluded calls\n` +
      `• \`!topcallercheck @user\` — Read-only Top Caller eligibility (Discord-ID-linked calls; draft thresholds)\n` +
      `• \`!approvetopcaller @user\` — Set caller trust to **top_caller**\n` +
      `• \`!removetopcaller @user\` — Clear **top_caller** → **approved**\n\n`;
  }

  // BOT OWNER ONLY
  if (isOwner) {
    contentOut +=
      `⚙️ **Bot owner only** (commands below enforce **BOT_OWNER_ID**)\n` +

      `📊 **Scanner thresholds**\n` +
      `• \`!setminmc\` / \`!setminliq\` / \`!setminvol5m\` / \`!setminvol1h\`\n` +
      `• \`!setmintxns5m\` / \`!setmintxns1h\` / \`!setapprovalx <number>\`\n` +
      `• \`!setapprovalladder\` — Custom approval milestone rungs (comma-separated)\n` +
      `• \`!xpostpreview <CA> [milestoneX]\` — Milestone X copy preview (no API); optional rung override\n\n` +

      `🧪 **Sanity filters**\n` +
      `• \`!setsanityminmc\` / \`!setsanityminliq\` / \`!setsanityminliqratio\` / \`!setsanitymaxliqratio\`\n` +
      `• \`!setsanitymaxratio5m\` / \`!setsanitymaxratio1h\`\n`;
  }

  await message.reply({
    content: contentOut,
    allowedMentions: { repliedUser: false }
  });

  return;
}

if (lowerContent === '!approvalstats') {
  const isModOrAdmin = message.member?.permissions?.has('ManageGuild');

  if (!isModOrAdmin) {
    await replyText(message, '❌ Only mods/admins can use this command.');
    return;
  }

  const stats = getApprovalStats();

  await message.reply({
    content:
      `📋 **Approval Stats**\n` +
      `• Pending approvals: **${stats.pending}**\n` +
      `• Approved bot calls: **${stats.approved}**\n` +
      `• Denied bot calls: **${stats.denied}**\n` +
      `• Expired / cleared: **${stats.expiredOrCleared}**\n` +
      `• Total tracked coins: **${stats.totalTracked}**`,
    allowedMentions: { repliedUser: false }
  });

  return;
}

if (lowerContent === '!pendingapprovals') {
  const isModOrAdmin = message.member?.permissions?.has('ManageGuild');

  if (!isModOrAdmin) {
    await replyText(message, '❌ Only mods/admins can use this command.');
    return;
  }

  const snapshot = getModQueuesSnapshot({
    xLimit: 8,
    coinLimit: 50,
    topBotLimit: 8
  });

  const pendingX = snapshot?.queues?.xVerifications?.items || [];
  const topPendingBot = snapshot?.queues?.coinApprovals?.topPendingBotByPriority || [];

  const xLines = pendingX.map((item, index) => {
    const name = item.displayName || `User ${index + 1}`;
    const handle = item.requestedHandle || 'Unknown';
    const minutes = Number.isFinite(item.minutesSinceRequested)
      ? item.minutesSinceRequested
      : 0;
    return `${index + 1}. **${name}** • ${handle} • ${minutes}m ago`;
  });

  const botLines = topPendingBot.map((item, index) => {
    const token = item.tokenName || 'Unknown';
    const ticker = item.ticker ? `$${item.ticker}` : '';
    const mult = Number(item?.priority?.currentOverEntryX || 0);
    return `${index + 1}. **${token}** ${ticker} • **${mult.toFixed(2)}x**`;
  });

  await message.reply({
    content:
      `📋 **Pending Approvals**\n\n` +
      `🔗 **Pending X Verifications**\n` +
      (xLines.length ? xLines.join('\n') : 'None') +
      `\n\n🔥 **Top Pending Bot Approval Coins**\n` +
      (botLines.length ? botLines.join('\n') : 'None'),
    allowedMentions: { repliedUser: false }
  });

  return;
}

if (lowerContent === '!recentcalls') {
  const isModOrAdmin = message.member?.permissions?.has('ManageGuild');

  if (!isModOrAdmin) {
    await replyText(message, '❌ Only mods/admins can use this command.');
    return;
  }

  const calls = getRecentBotCalls(10);

  if (!calls.length) {
    await replyText(message, 'ℹ️ No recent bot calls found.');
    return;
  }

  const lines = calls.map((call, index) => {
    const token = call.tokenName || 'Unknown';
    const ticker = call.ticker ? `$${call.ticker}` : '';
    const entryMc = Number(call.firstCalledMarketCap || call.marketCapAtCall || call.marketCap || 0);
    const currentMc = Number(call.latestMarketCap || call.currentMarketCap || call.marketCap || 0);
    const multiplier = entryMc > 0 ? (currentMc / entryMc).toFixed(2) : '0.00';
    const status = call.isActive === false ? 'Archived' : 'Active';

    return `${index + 1}. **${token}** ${ticker} • ${status} • Entry MC: **$${entryMc.toLocaleString()}** • Current MC: **$${currentMc.toLocaleString()}** • **${multiplier}x**`;
  });

  await message.reply({
    content:
      `🕒 **Recent Bot Calls**\n\n` +
      lines.join('\n'),
    allowedMentions: { repliedUser: false }
  });

  return;
}

if (lowerContent === '!monitorstatus') {
  const isModOrAdmin = message.member?.permissions?.has('ManageGuild');

  if (!isModOrAdmin) {
    await replyText(message, '❌ Only mods/admins can use this command.');
    return;
  }

  const allCalls = getAllTrackedCalls();

  const active = allCalls.filter(c => c.isActive).length;
  const archived = allCalls.filter(c => c.lifecycleStatus === 'archived').length;
  const pending = allCalls.filter(c => c.approvalStatus === 'pending').length;

  let scannerState = 'UNKNOWN';
  try {
    const settings = loadBotSettings();
    scannerState = settings?.scannerEnabled ? 'ON' : 'OFF';
  } catch (_) {}

  await message.reply({
    content:
      `📊 **Monitor Status**\n` +
      `• Active tracked coins: **${active}**\n` +
      `• Archived coins: **${archived}**\n` +
      `• Pending approvals: **${pending}**\n` +
      `• Scanner: **${scannerState}**`,
    allowedMentions: { repliedUser: false }
  });

  return;
}

if (lowerContent.startsWith('!testxintake')) {
  const isOwner = message.author.id === process.env.BOT_OWNER_ID;
  const isMod = message.member?.permissions?.has('ManageGuild');

  if (!isOwner && !isMod) {
    await replyText(message, '❌ **Manage Server** or bot owner only.');
    return;
  }

  if (!message.guild) {
    await replyText(message, '❌ Run this in a server channel.');
    return;
  }

  let rest = content.replace(/^!testxintake\s*/i, '').trim();
  let applyMode = false;

  if (/^apply(\s|$)/i.test(rest)) {
    if (!isOwner) {
      await replyText(
        message,
        '❌ **`apply`** is **bot owner only**.\nDefault is dry-run (mods with **Manage Server** can use that).'
      );
      return;
    }
    applyMode = true;
    rest = rest.replace(/^apply\s+/i, '').trim();
  }

  const parts = rest.split(/\s+/);
  if (parts.length < 3) {
    await replyText(
      message,
      '❌ **Usage**\n' +
        '`!testxintake <xHandle> <tweetId> <tweet text…>` — **dry-run** (default)\n' +
        '`!testxintake apply <xHandle> <tweetId> <tweet text…>` — **owner only**: real tracked call + dedupe\n\n' +
        '• `tweetId` must be **unique** per real run (dedupe store).\n' +
        '• Dry-run does **not** write `trackedCalls` or dedupe; `apply` does.'
    );
    return;
  }

  const authorHandle = parts[0];
  const tweetId = parts[1];
  const tweetText = parts.slice(2).join(' ');

  try {
    const result = await processVerifiedXMentionCallIntake(
      { authorHandle, tweetText, tweetId },
      {
        client,
        guild: message.guild,
        dryRun: !applyMode
      }
    );

    const embed = buildTestXIntakeResultEmbed(result, {
      applyMode,
      authorHandle,
      tweetId,
      tweetTextSample: tweetText
    });

    await message.reply({
      embeds: [embed],
      allowedMentions: { repliedUser: false }
    });
  } catch (err) {
    console.error('[testxintake]', err);
    await replyText(message, `❌ Test failed: ${err.message}`);
  }

  return;
}

if (lowerContent.startsWith('!testxmention')) {
  const isOwner = message.author.id === process.env.BOT_OWNER_ID;
  const isMod = message.member?.permissions?.has('ManageGuild');

  if (!isOwner && !isMod) {
    await replyText(message, '❌ **Manage Server** or bot owner only.');
    return;
  }

  if (!message.guild) {
    await replyText(message, '❌ Run this in a server channel.');
    return;
  }

  const parsed = parseTestXmentionContent(content);

  if (parsed.error === 'bad_reply') {
    await replyText(
      message,
      '❌ Invalid `to:` / `reply:` token. Use `to:1234567890` (digits only), e.g. after tweet id.'
    );
    return;
  }

  if (parsed.error === 'usage') {
    await replyText(
      message,
      '❌ **Usage**\n' +
        '`!testxmention <xHandle> <tweetId> [to:<parentTweetId>] <tweet text…>` — **dry-run** (default; full scaffold path)\n' +
        '`!testxmention apply <xHandle> <tweetId> [to:<parentTweetId>] <tweet text…>` — **owner only**: live intake + `maybePostIntakeReply` (still gated by `X_MENTION_POST_REPLIES` and X poster dry-run)\n\n' +
        '• **Live X parity:** include **`#call`** in tweet text for a tracked call; otherwise silent ignore (no ingest logs when tick logging is on).\n' +
        '• Same flow as mention ingestion: `processSingleCandidate` → reply policy → optional X reply.\n' +
        '• Default does **not** write tracked calls / dedupe; **`apply`** is owner-only.\n' +
        '• Real X replies require **`X_MENTION_POST_REPLIES`** (and X poster not in dry-run).'
    );
    return;
  }

  if (parsed.applyMode && !isOwner) {
    await replyText(
      message,
      '❌ **`apply`** is **bot owner only**.\nDefault inject is dry-run (mods with **Manage Server** can use that).'
    );
    return;
  }

  const candidate = {
    authorHandle: parsed.authorHandle,
    tweetText: parsed.tweetText,
    tweetId: parsed.tweetId,
    ...(parsed.replyToTweetId ? { replyToTweetId: parsed.replyToTweetId } : {})
  };

  try {
    const injectResult = await runInjectedMentionOnce(client, message.guild, candidate, {
      dryRun: !parsed.applyMode,
      attemptReplyAfterIntake: parsed.applyMode === true
    });

    const embed = buildTestXMentionInjectEmbed(injectResult, {
      applyMode: parsed.applyMode,
      authorHandle: parsed.authorHandle,
      tweetId: parsed.tweetId,
      tweetTextSample: parsed.tweetText,
      replyToTweetId: parsed.replyToTweetId
    });

    await message.reply({
      embeds: [embed],
      allowedMentions: { repliedUser: false }
    });
  } catch (err) {
    console.error('[testxmention]', err);
    await replyText(message, `❌ Inject failed: ${err.message}`);
  }

  return;
}

if (lowerContent === '!backfillprofiles' || lowerContent.startsWith('!backfillprofiles ')) {
  const isModOrAdmin = message.member?.permissions?.has('ManageGuild');

  if (!isModOrAdmin) {
    await replyText(message, '❌ Only members with **Manage Server** can run profile backfill.');
    return;
  }

  const guild = message.guild;
  if (!guild) {
    await replyText(message, '❌ Run this in a server channel.');
    return;
  }

  const sub = content.replace(/^!backfillprofiles\s*/i, '').trim().toLowerCase();

  if (sub === 'run') {
    const pre = await previewMemberProfileBackfill(guild);
    if (pre.error) {
      await replyText(message, '❌ Could not read this server.');
      return;
    }
    if (pre.missing === 0) {
      await replyText(
        message,
        `📋 Nothing to do — **0** missing profiles (humans: **${pre.totalHumans}**, bots skipped: **${pre.skippedBots}**).`
      );
      return;
    }

    const result = await runMemberProfileBackfill(guild);
    await replyText(
      message,
      `✅ **Profile backfill complete**\n` +
        `• Created: **${result.created}**\n` +
        `• Humans scanned: **${result.totalHumans}** (already had a profile: **${result.hadProfile}**)\n` +
        `• Bots skipped: **${result.skippedBots}**`
    );
    return;
  }

  const preview = await previewMemberProfileBackfill(guild);
  if (preview.error) {
    await replyText(message, '❌ Could not read this server.');
    return;
  }

  await replyText(
    message,
    `📋 **Profile backfill preview** (no changes yet)\n` +
      `• Humans in server: **${preview.totalHumans}**\n` +
      `• Missing profiles (would create): **${preview.missing}**\n` +
      `• Bots skipped: **${preview.skippedBots}**\n\n` +
      `To create missing profiles once: \`!backfillprofiles run\``
  );
  return;
}

if (lowerContent === '!resetmonitor') {
  const isModOrAdmin = message.member?.permissions?.has('ManageGuild');

  if (!isModOrAdmin) {
    await replyText(message, '❌ Only mods/admins can use this command.');
    return;
  }

  stopMonitoring();
  stopAutoCallLoop();
  SCANNER_ENABLED = false;
  BOT_SETTINGS.scannerEnabled = false;
  saveBotSettings(BOT_SETTINGS);

  resetAllTrackedCalls();

  await replyText(
    message,
    '🧹 Monitor reset complete.\n• All tracked coins cleared\n• Pending approval state cleared\n• Scanner turned OFF'
  );

  return;
}
      if (lowerContent === '!resetbotstats') {
        const isModOrAdmin = message.member?.permissions?.has('ManageGuild');

        if (!isModOrAdmin) {
          await replyText(message, '❌ Only mods/admins can reset bot stats.');
          return;
        }

        const result = excludeTrackedBotCallsFromStats({
          resetById: message.author.id,
          resetByUsername: message.author.username,
          resetReason: `Bot stats reset by ${message.author.username}`
        });

        if (!result?.updatedCount) {
          await replyText(message, '❌ No tracked bot-call stats found to reset.');
          return;
        }

        await replyText(
          message,
          `✅ Reset **${result.updatedCount}** tracked bot-call stat entr${result.updatedCount === 1 ? 'y' : 'ies'}.`
        );

        return;
      }
      if (lowerContent.startsWith('!caller ')) {
        const mentionedUser = message.mentions.users.first();

        let lookup = content.replace(/^!caller\s+/i, '').trim();

        if (mentionedUser) {
          const targetProfile = upsertUserProfile({
            discordUserId: mentionedUser.id,
            username: mentionedUser.username,
            displayName:
              message.guild?.members?.cache?.get(mentionedUser.id)?.displayName ||
              mentionedUser.globalName ||
              mentionedUser.username
          });

          lookup = {
            discordUserId: targetProfile.discordUserId,
            username: targetProfile.username,
            displayName: targetProfile.displayName
          };
        }

        if (!lookup) {
          await replyText(message, '❌ Usage: `!caller <username>` or `!caller @user`');
          return;
        }

        const stats = getCallerStats(lookup);
        const embed = createCallerCardEmbed(stats);

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }
if (lowerContent === '!truebotstats') {
        const isModOrAdmin = message.member?.permissions?.has('ManageGuild');

        if (!isModOrAdmin) {
          await replyText(message, '❌ Only mods/admins can use this command.');
          return;
        }

        const stats = getBotStatsRaw();

        if (!stats) {
          await replyText(message, '❌ No tracked bot-call data found.');
          return;
        }

        const embed = createCallerCardEmbed(stats)
          .setTitle('🤖 TRUE BOT STATS — McGBot')
          .setFooter({ text: `Includes reset/excluded bot calls • Requested by ${message.author.username}` });

        if (typeof stats.resetExcludedCount === 'number') {
          embed.addFields({
            name: 'Reset / Excluded Calls',
            value: `${stats.resetExcludedCount}`,
            inline: true
          });
        }

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }
if (lowerContent.startsWith('!truestats')) {
        const mentionedUser = message.mentions.users.first();
        const isModOrAdmin = message.member?.permissions?.has('ManageGuild');

        if (!mentionedUser) {
          await replyText(message, '❌ Usage: `!truestats @user`');
          return;
        }

        if (!isModOrAdmin) {
          await replyText(message, '❌ Only mods/admins can use this command.');
          return;
        }

        const targetProfile = upsertUserProfile({
          discordUserId: mentionedUser.id,
          username: mentionedUser.username,
          displayName:
            message.guild?.members?.cache?.get(mentionedUser.id)?.displayName ||
            mentionedUser.globalName ||
            mentionedUser.username
        });

        const stats = getCallerStatsRaw({
          discordUserId: targetProfile.discordUserId,
          username: targetProfile.username,
          displayName: targetProfile.displayName
        });

        if (!stats) {
          await replyText(
            message,
            `❌ No tracked caller data found for **${targetProfile.displayName || targetProfile.username}**.`
          );
          return;
        }

        const embed = createCallerCardEmbed(stats)
          .setTitle(`🧾 TRUE CALLER STATS — @${stats.username || targetProfile.username}`)
          .setFooter({ text: `Includes reset/excluded calls • Requested by ${message.author.username}` });

        if (typeof stats.resetExcludedCount === 'number') {
          embed.addFields({
            name: 'Reset / Excluded Calls',
            value: `${stats.resetExcludedCount}`,
            inline: true
          });
        }

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }
      if (lowerContent === '!callerboard') {
        const leaderboard = getCallerLeaderboard(10);
        const embed = createCallerLeaderboardEmbed(leaderboard);

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (lowerContent === '!bestcall24h') {
        const best = getBestCallInTimeframe(1);
        const embed = createSingleCallEmbed(best, '🏆 BEST USER CALL — LAST 24 HOURS');

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (lowerContent === '!bestcallweek') {
        const best = getBestCallInTimeframe(7);
        const embed = createSingleCallEmbed(best, '🏆 BEST USER CALL — LAST 7 DAYS');

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (lowerContent === '!bestcallmonth') {
        const best = getBestCallInTimeframe(30);
        const embed = createSingleCallEmbed(best, '🏆 BEST USER CALL — LAST 30 DAYS');

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (lowerContent === '!topcaller24h') {
        const top = getTopCallerInTimeframe(1);
        const embed = createTopCallerTimeframeEmbed(top, '👤 TOP CALLER — LAST 24 HOURS');

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (lowerContent === '!topcallerweek') {
        const top = getTopCallerInTimeframe(7);
        const embed = createTopCallerTimeframeEmbed(top, '👤 TOP CALLER — LAST 7 DAYS');

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (lowerContent === '!topcallermonth') {
        const top = getTopCallerInTimeframe(30);
        const embed = createTopCallerTimeframeEmbed(top, '👤 TOP CALLER — LAST 30 DAYS');

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (lowerContent === '!bestbot24h') {
        const best = getBestBotCallInTimeframe(1);
        const embed = createSingleCallEmbed(best, '🤖 BEST BOT CALL — LAST 24 HOURS');

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (lowerContent === '!bestbotweek') {
        const best = getBestBotCallInTimeframe(7);
        const embed = createSingleCallEmbed(best, '🤖 BEST BOT CALL — LAST 7 DAYS');

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (lowerContent === '!bestbotmonth') {
        const best = getBestBotCallInTimeframe(30);
        const embed = createSingleCallEmbed(best, '🤖 BEST BOT CALL — LAST 30 DAYS');

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (lowerContent.startsWith('!addlaunch ')) {
        const parts = content.split(/\s+/).filter(Boolean);

        if (parts.length < 3) {
          await replyText(message, '❌ Usage: `!addlaunch <dev_wallet> <token_ca>`');
          return;
        }

        const devWallet = parts[1];
        const tokenCa = parts[2];

        if (!isLikelySolWallet(devWallet) || !isLikelySolWallet(tokenCa)) {
          await replyText(message, '❌ Invalid wallet or contract address.');
          return;
        }

        const trackedDev = getTrackedDev(devWallet);
        if (!trackedDev) {
          await replyText(message, `❌ That dev wallet is not tracked yet.\n\`${devWallet}\``);
          return;
        }

        const trackedCall = getTrackedCall(tokenCa);
        if (!trackedCall) {
          await replyText(message, `❌ That CA was not found in tracked calls.\n\`${tokenCa}\``);
          return;
        }

        const athMarketCap = Number(
          trackedCall.ath ||
          trackedCall.athMc ||
          trackedCall.athMarketCap ||
          trackedCall.latestMarketCap ||
          trackedCall.firstCalledMarketCap ||
          0
        );

        const firstCalledMarketCap = Number(trackedCall.firstCalledMarketCap || 0);

        let xFromCall = 0;
        if (firstCalledMarketCap > 0 && athMarketCap > 0) {
          xFromCall = Number((athMarketCap / firstCalledMarketCap).toFixed(2));
        }

        const launchEntry = {
          tokenName: trackedCall.tokenName || 'Unknown Token',
          ticker: trackedCall.ticker || 'UNKNOWN',
          contractAddress: trackedCall.contractAddress,
          athMarketCap,
          firstCalledMarketCap,
          xFromCall,
          discordMessageId: trackedCall.discordMessageId || null,
          addedAt: new Date().toISOString()
        };

        const updatedDev = addLaunchToTrackedDev(devWallet, launchEntry);
        const embed = createDevLaunchAddedEmbed(updatedDev, launchEntry);

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (lowerContent.startsWith('!call ')) {
        const parts = content.split(/\s+/).filter(Boolean);
        const contractAddress = parts[1];

        if (!contractAddress) {
          await replyText(message, '⚠️ Usage: `!call [SOLANA_CONTRACT_ADDRESS]`');
          return;
        }

        try {
          await handleCallCommand(message, contractAddress, 'command');
        } catch (error) {
          console.error('[Call Command Error]', error);
          await replyText(message, `❌ Call failed: ${error.message}`);
        }

        return;
      }

      if (lowerContent.startsWith('!procall ')) {
        const trust = getCallerTrustLevel(message.author.id);
        if (trust !== 'trusted_pro') {
          await replyText(message, '❌ This command is **trusted_pro** only.');
          return;
        }

        const raw = content.replace(/^!procall\s+/i, '').trim();
        const { ca, title, why, risk } = parseProCallCommandArgs(raw);

        if (!ca) {
          await replyText(message, '⚠️ Usage: `!procall <ca> | <title> | <why> | <risk?>`');
          return;
        }

        if (!isLikelySolanaCA(ca)) {
          await replyText(message, '❌ Invalid Solana contract address.');
          return;
        }

        try {
          await handleCallCommand(message, ca, 'command', {
            proCall: {
              title,
              why,
              risk,
              sourceLabel: 'Discord (Trusted Pro submission)'
            }
          });
        } catch (error) {
          console.error('[ProCall Command Error]', error);
          await replyText(message, `❌ Pro call failed: ${error.message}`);
        }

        return;
      }

      if (lowerContent.startsWith('!watch ')) {
        const parts = content.split(/\s+/).filter(Boolean);
        const contractAddress = parts[1];

        if (!contractAddress) {
          await replyText(message, '⚠️ Usage: `!watch [SOLANA_CONTRACT_ADDRESS]`');
          return;
        }

        try {
          await handleWatchCommand(message, contractAddress, 'command');
        } catch (error) {
          console.error('[Watch Command Error]', error);
          await replyText(message, `❌ Watch failed: ${error.message}`);
        }

        return;
      }

      await handleBasicCommands(message);
      return;
    }

    if (isTrackedDevsChannel(channelName)) {
      const wallet = extractSolanaAddress(content);

      if (!wallet) return;
      if (!isLikelySolWallet(wallet)) return;

      const existing = getTrackedDev(wallet);

      if (existing) {
        const embed = createDevCheckEmbed({
          walletAddress: wallet,
          trackedDev: existing,
          checkedBy: message.author.username,
          contextLabel: 'Tracked Dev Profile',
          rankData: getDevRankData(existing)
        });

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        setDevEditSession(message.author.id, message.channel.id, {
          walletAddress: wallet,
          step: 'awaiting_menu_choice'
        });

        return;
      }

      const { nickname, note } = parseDevInput(content, wallet);

      const trackedDev = addTrackedDev({
        walletAddress: wallet,
        addedById: message.author.id,
        addedByUsername: message.author.username,
        nickname,
        note
      });

      const embed = createDevAddedEmbed(trackedDev);

      await message.reply({
        embeds: [embed],
        allowedMentions: { repliedUser: false }
      });

      return;
    }

    if (isDevFeedChannel(channelName)) {
      const wallet = extractSolanaAddress(content);

      if (wallet && isLikelySolWallet(wallet)) {
        const trackedDev = getTrackedDev(wallet);

        const embed = createDevCheckEmbed({
          walletAddress: wallet,
          trackedDev,
          checkedBy: message.author.username,
          contextLabel: 'Dev Check',
          rankData: trackedDev ? getDevRankData(trackedDev) : null
        });

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }
    }

    if (content.length > 80) return;

    const ca = extractSolanaAddress(content);
    if (!ca) return;
    if (!isLikelySolanaCA(ca)) return;

    try {
      await handleBasicCommands(message, {
        scanChannelNames: ['scanner', 'scanner-feed', 'calls', 'coin-calls', 'token-calls']
      });
      return;
    } catch (scanError) {
      console.error('[AutoScan Error]', scanError.message);
      await replyText(message, '❌ Failed to scan that contract address.');
    }

  } catch (error) {
    console.error('Message handler error:', error);

    try {
      await replyText(message, '❌ Something went wrong handling that message.');
    } catch (_) {}
  }
});

client.login(process.env.DISCORD_TOKEN);