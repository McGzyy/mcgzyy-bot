require('dotenv').config();

const path = require('path');
const { readJson, writeJson } = require('./utils/jsonStore');

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits
} = require('discord.js');

const {
  handleBasicCommands,
  handleCallCommand,
  handleWatchCommand,
  isLikelySolanaCA
} = require('./commands/basicCommands');

const { handleGuideCommand } = require('./utils/guideCommand');
const { handleInteractiveHelp } = require('./utils/interactiveHelp');
const { handleHelpUiInteraction } = require('./utils/helpUi');
const { handleFaqCommand } = require('./utils/faqCommand');
const { startMonitoring, stopMonitoring } = require('./utils/monitoringEngine');
const { startAutoCallLoop, stopAutoCallLoop } = require('./utils/autoCallEngine');
const { createPost } = require('./utils/xPoster');
const {
  buildOhlcvCandlestickBufferForTrackedCall
} = require('./utils/ohlcvCandlestickBuffer');
const { handleOhlcvTimeframeButton } = require('./utils/ohlcvChartControls');
const { resolveGuildForTrackedApproval } = require('./utils/resolveGuildForTrackedApproval');
const { setBotEmbedThumbnailFallbackUrl } = require('./utils/embedTokenThumbnail');
const {
  buildCompactCoinApprovalEmbed,
  buildCompactXVerifyEmbed,
  applyCompactFinalViewToMessage,
  finalizeWithCompactEmbed,
  resolveCoinDeletionKind
} = require('./utils/approvalMessageLifecycle');

const { recordModAction } = require('./utils/modActionsService');
const { startAdminReports } = require('./utils/adminReportsService');
const {
  createPendingDevSubmission,
  takePendingDevSubmission,
  returnPendingDevSubmission,
  updatePendingDevSubmission,
  parseCommaSeparatedAddresses,
  parseDevSubmitTags,
  parseDevSubmitNotesAndTags,
  coerceStoredDevXHandle
} = require('./utils/devSubmissionService');

const {
  createAutoCallEmbed,
  createDevAddedEmbed,
  createDevCheckEmbed,
  createDevLaunchAddedEmbed,
  createDevLeaderboardEmbed,
  createCallerCardEmbed,
  createCallerLeaderboardEmbed,
  createSingleCallEmbed,
  createTopCallerTimeframeEmbed,
  createReferralCommandEmbed,
  createReferralLeaderboardEmbed
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
  getDevLeaderboard,
  findTrackedDevsByLookup
} = require('./utils/devRegistryService');

const {
  getCallerStats,
  getCallerStatsRaw,
  getBotStats,
  getBotStatsRaw,
  getCallerLeaderboard,
  getTopCallerInTimeframe,
  getBestCallInTimeframe,
  getBestBotCallInTimeframe
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

const {
  upsertUserProfile,
  getUserProfileByDiscordId,
  setPublicCreditMode,
  startXVerification,
  getPendingXVerifications,
  completeXVerification,
  denyXVerification,
  getPreferredPublicName,
  normalizeXHandle,
  isLikelyXHandle
} = require('./utils/userProfileService');

const {
  hydrateInviteCacheFromClient,
  handleGuildMemberAdd: handleReferralGuildMemberAdd,
  getReferralStatsForReferrer,
  getReferralLeaderboardTop,
  getOrCreateUserReferral
} = require('./utils/referralService');

const { startReferralApiServer } = require('./apiServer');
const { getSupabase } = require('./utils/supabaseClient');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

const devEditSessions = new Map();
const DEV_EDIT_SESSION_TTL_MS = 10 * 60 * 1000;

const xVerificationSessions = new Map();
const X_VERIFY_SESSION_TTL_MS = 30 * 60 * 1000;
const X_VERIFY_CHANNEL_NAME = 'verify-x';
const X_VERIFY_CHANNEL_SLUGS = new Set(['verify-x', 'x-verify']);

function isXVerifyChannelSlug(name) {
  return X_VERIFY_CHANNEL_SLUGS.has(String(name || ''));
}

function findXVerifyTextChannel(guild) {
  if (!guild?.channels?.cache) return null;
  return (
    guild.channels.cache.find(
      ch => ch.isTextBased() && isXVerifyChannelSlug(ch.name)
    ) || null
  );
}

const DEV_INTEL_PROMPT_TITLE = '📋 Submit a Dev';
const DEV_INTEL_CHANNEL_SLUGS = new Set(['dev-intel']);

function findDevIntelTextChannel(guild) {
  if (!guild?.channels?.cache) return null;
  return (
    guild.channels.cache.find(
      ch => ch.isTextBased() && DEV_INTEL_CHANNEL_SLUGS.has(ch.name)
    ) || null
  );
}

function getModApprovalsChannel(guild) {
  if (!guild?.channels?.cache) return null;
  return (
    guild.channels.cache.find(
      ch =>
        ch &&
        ch.isTextBased &&
        typeof ch.isTextBased === 'function' &&
        ch.isTextBased() &&
        ch.name === 'mod-approvals'
    ) || null
  );
}

const X_VERIFIED_ROLE_NAME = 'X Verified';
const MOD_CHANNEL_NAME = 'mod-chat';

const BOT_SETTINGS_PATH = path.join(__dirname, 'data', 'botSettings.json');

let BOT_SETTINGS = { scannerEnabled: true };
let SCANNER_ENABLED = true;

async function hydrateBotSettingsFromDisk() {
  try {
    const parsed = /** @type {{ scannerEnabled?: boolean }} */ (await readJson(BOT_SETTINGS_PATH));
    return {
      scannerEnabled: parsed.scannerEnabled !== false
    };
  } catch (error) {
    const code = error && /** @type {{ code?: string }} */ (error).code;
    if (code === 'ENOENT') {
      const defaults = { scannerEnabled: true };
      try {
        await writeJson(BOT_SETTINGS_PATH, defaults);
      } catch (e) {
        console.error(
          '[BotSettings] Failed to create default settings file:',
          /** @type {Error} */ (e).message
        );
      }
      return defaults;
    }
    if (error instanceof SyntaxError) {
      console.error('[BotSettings] Invalid JSON in botSettings.json:', error.message);
      return { scannerEnabled: true };
    }
    console.error('[BotSettings] Failed to load settings:', /** @type {Error} */ (error).message);
    return { scannerEnabled: true };
  }
}

function loadBotSettings() {
  return { ...BOT_SETTINGS };
}

function saveBotSettings(settings) {
  try {
    BOT_SETTINGS = { ...settings };
    writeJson(BOT_SETTINGS_PATH, BOT_SETTINGS).catch((error) => {
      console.error('[BotSettings] Failed to save settings:', error.message);
    });
  } catch (error) {
    console.error('[BotSettings] Failed to save settings:', error.message);
  }
}

function extractSolanaAddress(text) {
  const match = text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
  return match ? match[0] : null;
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

function splitDiscordMessage(content, limit = 1900) {
  const text = String(content ?? '');
  if (!text) return [''];

  const chunks = [];
  const paragraphs = text.split('\n\n');

  let current = '';
  const pushCurrent = () => {
    if (current) chunks.push(current);
    current = '';
  };

  const appendPiece = piece => {
    if (!current) {
      current = piece;
      return;
    }

    const candidate = `${current}\n\n${piece}`;
    if (candidate.length <= limit) {
      current = candidate;
      return;
    }

    pushCurrent();
    current = piece;
  };

  for (const para of paragraphs) {
    if (para.length <= limit) {
      appendPiece(para);
      continue;
    }

    // paragraph too long; fall back to line-based split
    const lines = para.split('\n');
    let lineBlock = '';

    const flushLineBlock = () => {
      if (lineBlock) appendPiece(lineBlock);
      lineBlock = '';
    };

    for (const line of lines) {
      if (line.length > limit) {
        flushLineBlock();
        // final fallback: hard slice a single very-long line
        for (let i = 0; i < line.length; i += limit) {
          appendPiece(line.slice(i, i + limit));
        }
        continue;
      }

      if (!lineBlock) {
        lineBlock = line;
        continue;
      }

      const candidate = `${lineBlock}\n${line}`;
      if (candidate.length <= limit) {
        lineBlock = candidate;
      } else {
        flushLineBlock();
        lineBlock = line;
      }
    }

    flushLineBlock();
  }

  pushCurrent();
  return chunks.length ? chunks : [''];
}

async function replyLongText(message, content, limit = 1900) {
  const chunks = splitDiscordMessage(content, limit);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (i === 0) {
      await replyText(message, chunk);
    } else {
      await message.channel.send({
        content: chunk,
        allowedMentions: { repliedUser: false }
      });
    }
  }
}

const DM_BLOCKED_COMMAND_LIST_REPLY =
  "I couldn't DM you. Please enable DMs and try again.";

/**
 * Plain-text McGBot command list (same sections as legacy !help / !commands).
 * @param {import('discord.js').Message} message
 * @param {{ memberCanManageGuild: Function, isBotOwner: Function }} permissions
 */
function buildMcgbotCommandListText(message, { memberCanManageGuild, isBotOwner }) {
  const canSeeModHelp = memberCanManageGuild(message.member) || isBotOwner(message.author);
  const canSeeOwnerHelp = isBotOwner(message.author);

  let contentOut = `📘 **McGBot Command List**\n\n`;

  contentOut +=
    `👤 **User Commands**\n` +
    `• \`!help\` / \`!commands\` — This list\n` +
    `• \`!ping\` — Quick alive check\n` +
    `• \`!status\` — Bot status\n` +
    `• \`!ca <ca>\` — Compact contract intel (no tracking)\n` +
    `• \`!scan\` — Random scanner-style test\n` +
    `• \`!scan <ca>\` — Deep scan a token (no tracking)\n` +
    `• \`!call <ca>\` — Official call + track\n` +
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

  if (canSeeModHelp) {
    contentOut +=
      `🛡️ **Mod / Manage Server**\n` +
      `• Approval buttons in **#mod-approvals** / mod flows\n` +
      `• \`!approvalstats\` — Approval queue counts\n` +
      `• \`!pendingapprovals\` — Pending X verifications + top pending **bot** approvals\n` +
      `• \`!recentcalls\` — Recent bot-tracked calls\n` +
      `• \`!monitorstatus\` — Active / archived / pending / scanner state\n` +
      `• \`!scanner\` — Show whether scanner is ON or OFF\n` +
      `• \`!scanner on\` / \`!scanner off\` — Start or stop scanner + monitor + auto-call\n` +
      `• \`!verifyx @user\` — Approve a member’s pending X verification (requires **Manage Server**)\n` +
      `• \`!resetbotstats\` — Reset bot-call stat exclusions on tracked data\n` +
      `• \`!resetmonitor\` — **Destructive:** clear all tracked coins, stop scanner & loops\n` +
      `• \`!truestats @user\` — Caller stats including reset/excluded calls\n` +
      `• \`!truebotstats\` — Bot stats including reset/excluded calls\n\n`;
  }

  if (canSeeOwnerHelp) {
    contentOut +=
      `⚙️ **Bot owner only** (commands below enforce **BOT_OWNER_ID**)\n` +

      `📊 **Scanner thresholds**\n` +
      `• \`!setminmc\` / \`!setminliq\` / \`!setminvol5m\` / \`!setminvol1h\`\n` +
      `• \`!setmintxns5m\` / \`!setmintxns1h\` / \`!setapprovalx <number>\`\n` +
      `• \`!setapprovalladder\` — Custom approval milestone rungs (comma-separated)\n\n` +

      `🧪 **Sanity filters**\n` +
      `• \`!setsanityminmc\` / \`!setsanityminliq\` / \`!setsanityminliqratio\` / \`!setsanitymaxliqratio\`\n` +
      `• \`!setsanitymaxratio5m\` / \`!setsanitymaxratio1h\`\n`;
  }

  return contentOut;
}

function memberCanManageGuild(member) {
  if (!member?.permissions) return false;
  try {
    return member.permissions.has(PermissionFlagsBits.ManageGuild);
  } catch {
    return false;
  }
}

function isBotOwner(user) {
  const expected = String(process.env.BOT_OWNER_ID ?? '').trim();
  if (!expected) return false;
  return String(user?.id) === expected;
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

/**
 * Single-guild bots behave as before. Multi-guild: DISCORD_GUILD_ID, else guild with #bot-calls (stable id order), else stable fallback.
 * Does not use guilds.cache.first().
 *
 * @param {import('discord.js').Client} discordClient
 */
function getPrimaryGuildForBotAlerts(discordClient) {
  if (!discordClient?.guilds?.cache) return null;

  const envId = String(process.env.DISCORD_GUILD_ID ?? '').trim();
  if (envId) {
    const g = discordClient.guilds.cache.get(envId);
    if (g) return g;
  }

  const values = [...discordClient.guilds.cache.values()];
  if (values.length === 1) return values[0];

  const withBotCalls = values
    .filter((g) => getBotCallsChannel(g))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (withBotCalls.length) return withBotCalls[0];

  return values.sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
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
        .setCustomId('xverify_start')
        .setLabel('Verify X Account')
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function buildVerifyXHandleModal(options = {}) {
  const fromChannel = options.fromChannel === true;
  return new ModalBuilder()
    .setCustomId(fromChannel ? 'verify_x_handle_modal_channel' : 'verify_x_handle_modal')
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

function buildDevIntelChannelEmbed() {
  return new EmbedBuilder()
    .setColor(0x10b981)
    .setTitle(DEV_INTEL_PROMPT_TITLE)
    .setDescription([
      'Submit a developer for the **tracked devs** registry.',
      '',
      'Mods review submissions in **#mod-approvals**. **Nothing is added to the registry until a mod approves.**',
      '',
      '• **Dev name** is required.',
      '• **At least one Solana dev wallet** is required (comma-separated if several).',
      '• **Coins (CAs)** are optional — known tokens can be linked from tracked calls after approval.',
      '• **X handle** is optional (`@name` or profile link).',
      '• **Tags / notes:** optional — for tags, start the notes box with `Tags: tag1, tag2` on line 1, then your notes below.'
    ].join('\n'))
    .setTimestamp();
}

function buildDevIntelChannelButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('dev_submit_start')
        .setLabel('Submit Dev')
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function buildDevSubmitModal() {
  return new ModalBuilder()
    .setCustomId('dev_submit_modal')
    .setTitle('Submit dev for mod review')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('dev_sm_nick')
          .setLabel('Dev name / nickname')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('dev_sm_coins')
          .setLabel('Coins (CAs), comma-separated — optional')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder('Token mint addresses')
          .setMaxLength(1000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('dev_sm_wallets')
          .setLabel('Wallets — comma-separated (≥1 required)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder('Solana dev wallet(s)')
          .setMaxLength(1000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('dev_sm_xhandle')
          .setLabel('X Handle — optional')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('@username or link')
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('dev_sm_notes')
          .setLabel('Tags & notes — optional')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder('Tags: tag1, tag2 (optional, line 1)\n\nNotes…')
          .setMaxLength(1000)
      )
    );
}

function buildDevSubmissionReviewEmbed(submission) {
  const fmtList = (arr, max = 15) => {
    if (!Array.isArray(arr) || !arr.length) return '—';
    const slice = arr.slice(0, max);
    const lines = slice.map(a => `\`${a}\``).join('\n');
    return arr.length > max ? `${lines}\n*+${arr.length - max} more*` : lines;
  };

  const tags =
    Array.isArray(submission.tags) && submission.tags.length
      ? submission.tags.join(', ')
      : '—';

  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle('🧪 Dev submission — pending review')
    .setDescription(
      `**Submitted by:** <@${submission.submitterId}> (${submission.submitterUsername})\n**ID:** \`${submission.id}\``
    )
    .addFields(
      { name: 'Nickname', value: (submission.nickname || '—').slice(0, 1024), inline: false },
      {
        name: 'X handle',
        value: (submission.xHandle || '—').toString().slice(0, 1024),
        inline: false
      },
      { name: 'Wallets', value: fmtList(submission.walletAddresses).slice(0, 1024), inline: false },
      { name: 'Coins (CAs)', value: fmtList(submission.coinAddresses).slice(0, 1024), inline: false },
      { name: 'Tags', value: tags.slice(0, 1024), inline: false },
      { name: 'Notes', value: (submission.notes || '—').slice(0, 1024), inline: false }
    )
    .setTimestamp(new Date(submission.createdAt));
}

function buildDevSubmissionReviewButtons(submissionId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`dev_sub_approve:${submissionId}`)
        .setLabel('Approve dev')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`dev_sub_deny:${submissionId}`)
        .setLabel('Deny')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`dev_sub_edit:${submissionId}`)
        .setLabel('Edit')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function buildDevSubmissionEditModal(submissionId, submission) {
  const walletsStr = (submission.walletAddresses || []).join(', ');
  const coinsStr = (submission.coinAddresses || []).join(', ');
  const tagsStr = (submission.tags || []).join(', ');
  const notesStr = String(submission.notes || '');
  const xHandleStr = String(submission.xHandle || '');

  const clip = (s, max) => String(s || '').slice(0, max);

  return new ModalBuilder()
    .setCustomId(`dev_sub_edit_modal:${submissionId}`)
    .setTitle('Edit submission (mods)')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('dev_ed_wallets')
          .setLabel('Wallets — comma-separated (≥1)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setValue(clip(walletsStr, 950))
          .setMaxLength(1000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('dev_ed_coins')
          .setLabel('Coins (CAs) — comma-separated')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue(clip(coinsStr, 950))
          .setMaxLength(1000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('dev_ed_tags')
          .setLabel('Tags — comma-separated')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(clip(tagsStr, 95))
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('dev_ed_xhandle')
          .setLabel('X Handle — optional')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('@username or link')
          .setValue(clip(xHandleStr, 95))
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('dev_ed_notes')
          .setLabel('Notes')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue(clip(notesStr, 950))
          .setMaxLength(1000)
      )
    );
}

function appendMergedDevNote(existingNote, sectionLabel, body) {
  const b = String(body || '').trim();
  if (!b) return String(existingNote || '').trim();
  const prev = String(existingNote || '').trim();
  const block = `**${sectionLabel}**\n${b}`;
  if (!prev) return block.slice(0, 3500);
  return `${prev}\n\n---\n${block}`.slice(0, 3500);
}

async function refreshDevSubmissionApprovalMessage(client, submission) {
  try {
    const gid = submission.approvalGuildId;
    const cid = submission.approvalChannelId;
    const mid = submission.approvalMessageId;
    if (!gid || !cid || !mid) return false;

    const guild =
      client.guilds.cache.get(gid) || (await client.guilds.fetch(gid).catch(() => null));
    if (!guild) return false;

    const channel =
      guild.channels.cache.get(cid) || (await guild.channels.fetch(cid).catch(() => null));
    if (
      !channel ||
      typeof channel.isTextBased !== 'function' ||
      !channel.isTextBased()
    ) {
      return false;
    }

    const msg = await channel.messages.fetch(mid).catch(() => null);
    if (!msg) return false;

    const fresh = await peekPendingDevSubmission(submission.id);
    if (!fresh) return false;

    await msg.edit({
      embeds: [buildDevSubmissionReviewEmbed(fresh)],
      components: buildDevSubmissionReviewButtons(submission.id)
    });
    return true;
  } catch (e) {
    console.error('[DevSubmission] Refresh approval message failed:', e.message || e);
    return false;
  }
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
  const status = trackedCall.approvalStatus || 'pending';

  if (status === 'approved' || status === 'denied') {
    const ca = trackedCall.contractAddress || 'Unknown';
    const tokenLine = `$${trackedCall.ticker || 'UNKNOWN'} — ${trackedCall.tokenName || 'Unknown Token'}`;
    const triggerX = Number(trackedCall.lastApprovalTriggerX || 0);
    const resultLine =
      triggerX > 0 ? `📈 ${formatX(triggerX)} from call` : '📈 —';

    const tagsCompact =
      Array.isArray(trackedCall.moderationTags) && trackedCall.moderationTags.length
        ? trackedCall.moderationTags.map(t => `\`${t}\``).join(' ')
        : '—';
    const notesCompact = trackedCall.moderationNotes || '—';

    const lines = [
      `**${tokenLine}**`,
      `**CA:** \`${ca}\``,
      resultLine,
      '',
      `**Tags:** ${tagsCompact}`,
      `**Notes:** ${notesCompact}`
    ];

    lines.push(...getResolutionLines(trackedCall));

    return new EmbedBuilder()
      .setColor(status === 'approved' ? 0x22c55e : 0xef4444)
      .setTitle(
        status === 'approved'
          ? '✅ Coin Approved'
          : '❌ Coin Denied'
      )
      .setDescription(lines.join('\n'))
      .setFooter({
        text: trackedCall.moderatedByUsername
          ? `Moderated by ${trackedCall.moderatedByUsername}`
          : 'Resolved'
      })
      .setTimestamp();
  }

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

  const statusLabel =
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

  const descriptionLines = [
    `## ${statusLabel}`,
    '',
    `**Caller:** ${callerLabel}`,
    `**CA:** \`${ca}\``,
    `**Links:** ${links}`,
    '',
    `### 📈 Performance`,
    `**Current X:** ${formatX(currentX)} • **ATH X:** ${formatX(x)} • **Trigger:** ${formatX(trackedCall.lastApprovalTriggerX)}`,
    `**Current MC:** ${formatUsd(currentMc)} • **ATH MC:** ${formatUsd(ath)}`,
    `**Drawdown from ATH:** ${formatPercent(drawdown)}`,
    '',
    `### 📊 Call Details`,
    `**First Called MC:** ${formatUsd(firstCalledMc)}`,
    `**Excluded From Stats:** ${trackedCall.excludedFromStats ? 'Yes' : 'No'}`,
    `**Tags:** ${tags}`,
    `**Notes:** ${trackedCall.moderationNotes || 'None'}`
  ];

  descriptionLines.push(...getResolutionLines(trackedCall));

  const embed = new EmbedBuilder()
    .setColor(
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

function buildXPostText(trackedCall) {
  const ticker = trackedCall.ticker || 'UNKNOWN';
  const ca = trackedCall.contractAddress || '';
  const firstCalledMc = Number(trackedCall.firstCalledMarketCap || 0);
  const latestMc = Number(
    trackedCall.latestMarketCap ||
    trackedCall.firstCalledMarketCap ||
    0
  );
  const displayX =
    firstCalledMc > 0 ? Number((latestMc / firstCalledMc).toFixed(2)) : 0;

  const initialMcStr = formatUsd(firstCalledMc);
  const athMcStr = formatUsd(
    trackedCall.ath ||
    trackedCall.athMc ||
    trackedCall.athMarketCap ||
    trackedCall.latestMarketCap ||
    trackedCall.firstCalledMarketCap ||
    0
  );

  return [
    `🚀 $${ticker} — ${displayX.toFixed(2)}x from call`,
    ``,
    `Called by: @McGBot`,
    ``,
    `Initial MC: ${initialMcStr}`,
    `ATH MC: ${athMcStr}`,
    ``,
    `CA:`,
    `\`${ca}\``,
    ``,
    `📊 DexScreener: https://dexscreener.com/solana/${ca}`,
    `📊 GMGN: https://gmgn.ai/sol/token/${ca}`
  ].join('\n');
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

  const postText = buildXPostText(trackedCall);

  let chartBuf = null;
  if (!hasOriginal) {
    chartBuf = await buildOhlcvCandlestickBufferForTrackedCall(trackedCall, null);
  }

  const result = await createPost(
    postText,
    hasOriginal ? trackedCall.xOriginalPostId : null,
    chartBuf || undefined
  );

  if (!result.success || !result.id) {
    return {
      success: false,
      reason: 'x_post_failed',
      error: result.error || null
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

async function cleanupExpiredApprovals() {
  try {
    const allCalls = getAllTrackedCalls();
    const now = Date.now();

    for (const trackedCall of allCalls) {
      if (!trackedCall.approvalMessageId || !trackedCall.approvalExpiresAt) continue;
      if (trackedCall.approvalStatus !== 'pending') continue;

      const expiresAt = new Date(trackedCall.approvalExpiresAt).getTime();
      if (!Number.isFinite(expiresAt)) continue;

      if (now >= expiresAt) {
        setApprovalStatus(trackedCall.contractAddress, 'expired');
        await refreshApprovalMessage(trackedCall.contractAddress, true);

        console.log(`[ApprovalQueue] Expired approval marked for ${trackedCall.contractAddress}`);
      }
    }
  } catch (error) {
    console.error('[ApprovalQueue] Cleanup error:', error.message);
  }
}

async function refreshApprovalMessage(contractAddress, forceLocked = false) {
  const trackedCall = getTrackedCall(contractAddress);
  if (!trackedCall || !trackedCall.approvalChannelId || !trackedCall.approvalMessageId) return;

  const guild = await resolveGuildForTrackedApproval(client, trackedCall);
  if (!guild) {
    console.error('[ApprovalQueue] Failed to refresh approval message: could not resolve guild');
    return;
  }

  try {
    const channel = guild.channels.cache.get(trackedCall.approvalChannelId);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(trackedCall.approvalMessageId).catch(() => null);
    if (!message) return;

    const latest = getTrackedCall(contractAddress) || trackedCall;
    const isLocked = forceLocked || latest.approvalStatus !== 'pending';

    if (isLocked) {
      const compactEmbed = buildCompactCoinApprovalEmbed(latest);
      const delKind = resolveCoinDeletionKind(channel);
      await applyCompactFinalViewToMessage(
        message,
        compactEmbed,
        delKind === 'premium' ? 'premium' : 'coin'
      );
    } else {
      await message.edit({
        embeds: [buildApprovalStatusEmbed(latest)],
        components: buildApprovalButtons(contractAddress)
      });
    }
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
      migrated: trackedCall.migrated === true,
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
  if (!isXVerifyChannelSlug(channelName)) return false;

  if (message.author.bot) return true;

  upsertUserProfile({
    discordUserId: message.author.id,
    username: message.author.username,
    displayName: message.member?.displayName || message.author.globalName || message.author.username
  });

  return false;
}

async function ensureDevIntelPrompt(guild) {
  try {
    if (!guild) return;

    const intelChannel = findDevIntelTextChannel(guild);
    if (!intelChannel) return;

    const recentMessages = await intelChannel.messages.fetch({ limit: 10 }).catch(() => null);
    if (!recentMessages) return;

    const existingBotPrompt = recentMessages.find(
      msg =>
        msg.author?.id === client.user.id && msg.embeds?.[0]?.title === DEV_INTEL_PROMPT_TITLE
    );

    if (existingBotPrompt) return;

    await intelChannel.send({
      embeds: [buildDevIntelChannelEmbed()],
      components: buildDevIntelChannelButtons()
    });
  } catch (error) {
    console.error('[DevIntel] Failed to ensure dev-intel prompt:', error.message);
  }
}

async function handleDevSubmissionApprove(interaction, submissionId) {
  if (!interaction.guild) {
    await interaction.reply({ content: '❌ Use this in a server.', ephemeral: true });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: '❌ You do not have permission to use this.',
      ephemeral: true
    });
    return;
  }

  if (interaction.channel?.name !== 'mod-approvals') {
    await interaction.reply({
      content: '❌ This action can only be used in #mod-approvals.',
      ephemeral: true
    });
    return;
  }

  const submission = await takePendingDevSubmission(submissionId);
  if (!submission) {
    await interaction.reply({
      content: 'This submission was already handled.',
      ephemeral: true
    });
    return;
  }

  const wallets = submission.walletAddresses || [];
  if (!wallets.length) {
    await returnPendingDevSubmission(submission);
    await interaction.reply({
      content: '❌ Submission has no wallet — cannot approve. Restored to queue.',
      ephemeral: true
    });
    return;
  }

  let mergeTarget = null;
  for (const w of wallets) {
    if (getTrackedDev(w)) {
      mergeTarget = w;
      break;
    }
  }

  const targetWallet = mergeTarget || wallets[0];
  const isMerge = mergeTarget !== null;
  const tagList = Array.isArray(submission.tags) ? submission.tags : [];
  const notInTracker = (submission.coinAddresses || []).filter(ca => !getTrackedCall(ca));
  const otherWallets = wallets.filter(w => w !== targetWallet);

  try {
    let launchesLinked = 0;

    if (isMerge) {
      const existing = getTrackedDev(targetWallet);
      if (!existing) {
        throw new Error('Merge target dev missing');
      }

      let mergedTags = [...new Set([...(existing.tags || []), ...tagList])].slice(0, 25);

      let note = existing.note || '';
      if (submission.notes) {
        note = appendMergedDevNote(note, 'Mod-reviewed notes', submission.notes);
      }
      if (otherWallets.length) {
        note = appendMergedDevNote(note, 'Wallets merged from submission', otherWallets.join(', '));
      }
      if (notInTracker.length) {
        note = appendMergedDevNote(
          note,
          'CAs not in tracked calls',
          `${notInTracker.join(', ')} (add manually if needed)`
        );
      }

      const updates = { tags: mergedTags, note };
      const nick = String(submission.nickname || '').trim();
      if (nick && !String(existing.nickname || '').trim()) {
        updates.nickname = nick;
      }
      const subX = coerceStoredDevXHandle(submission.xHandle || '');
      if (subX) {
        updates.xHandle = subX;
      }
      updateTrackedDev(targetWallet, updates);

      for (const ca of submission.coinAddresses || []) {
        const trackedCall = getTrackedCall(ca);
        if (!trackedCall) continue;
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
          migrated: trackedCall.migrated === true,
          discordMessageId: trackedCall.discordMessageId || null,
          addedAt: new Date().toISOString()
        };
        if (addLaunchToTrackedDev(targetWallet, launchEntry)) {
          launchesLinked += 1;
        }
      }
    } else {
      const noteParts = [submission.notes].filter(Boolean);
      if (otherWallets.length) {
        noteParts.push(`Additional wallets: ${otherWallets.join(', ')}`);
      }
      if (notInTracker.length) {
        noteParts.push(`CAs not in tracked calls (add manually if needed): ${notInTracker.join(', ')}`);
      }
      const combinedNote = noteParts.join('\n\n').slice(0, 3500);

      const subXNew = coerceStoredDevXHandle(submission.xHandle || '');
      const createdDev = addTrackedDev({
        walletAddress: targetWallet,
        addedById: submission.submitterId,
        addedByUsername: submission.submitterUsername || 'Unknown',
        nickname: submission.nickname,
        note: combinedNote,
        xHandle: subXNew
      });

      if (tagList.length && createdDev) {
        const merged = [...new Set([...(createdDev.tags || []), ...tagList])].slice(0, 25);
        updateTrackedDev(targetWallet, { tags: merged });
      }

      for (const ca of submission.coinAddresses || []) {
        const trackedCall = getTrackedCall(ca);
        if (!trackedCall) continue;
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
          migrated: trackedCall.migrated === true,
          discordMessageId: trackedCall.discordMessageId || null,
          addedAt: new Date().toISOString()
        };
        if (addLaunchToTrackedDev(targetWallet, launchEntry)) {
          launchesLinked += 1;
        }
      }
    }

    recordModAction({
      moderatorId: interaction.user.id,
      actionType: 'dev',
      dedupeKey: `interaction:${interaction.id}:dev_sub_approve:${submissionId}`
    });

    await interaction.deferUpdate();
    const mergeLine = isMerge ? '\n**Mode:** merged into existing dev' : '';
    const doneEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('✅ Dev submission approved')
      .setDescription(
        [
          `**Registry wallet:** \`${targetWallet}\` — **${submission.nickname || '—'}**`,
          `**Launches linked from tracked calls:** ${launchesLinked}`,
          `**Approved by:** <@${interaction.user.id}>${mergeLine}`
        ].join('\n')
      )
      .setTimestamp();

    await interaction.message.edit({ embeds: [doneEmbed], components: [] });
  } catch (e) {
    console.error('[DevSubmission] Approve failed:', e.message || e);
    await returnPendingDevSubmission(submission);
    try {
      await interaction.reply({
        content: `❌ Failed to apply submission: ${e.message || 'error'}`,
        ephemeral: true
      });
    } catch (_) {}
  }
}

async function handleDevSubmissionDeny(interaction, submissionId) {
  if (!interaction.guild) {
    await interaction.reply({ content: '❌ Use this in a server.', ephemeral: true });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: '❌ You do not have permission to use this.',
      ephemeral: true
    });
    return;
  }

  if (interaction.channel?.name !== 'mod-approvals') {
    await interaction.reply({
      content: '❌ This action can only be used in #mod-approvals.',
      ephemeral: true
    });
    return;
  }

  const submission = await takePendingDevSubmission(submissionId);
  if (!submission) {
    await interaction.reply({
      content: 'This submission was already handled.',
      ephemeral: true
    });
    return;
  }

  await interaction.deferUpdate();
  const deniedEmbed = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle('❌ Dev submission denied')
    .setDescription(
      `**Nickname:** ${submission.nickname}\n**Denied by:** <@${interaction.user.id}>`
    )
    .setTimestamp();

  await interaction.message.edit({ embeds: [deniedEmbed], components: [] });
}

async function ensureVerifyXPrompt(guild) {
  try {
    if (!guild) return;

    const verifyChannel = findXVerifyTextChannel(guild);
    if (!verifyChannel) return;

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

  setImmediate(() => {
    try {
      startAdminReports(client);
    } catch (e) {
      console.error('[AdminReports] startAdminReports failed:', e.message || e);
    }
  });

  try {
    setBotEmbedThumbnailFallbackUrl(
      client.user.displayAvatarURL({ extension: 'png', size: 256 })
    );
  } catch (_) {
    /* optional thumbnail fallback */
  }

  const firstGuild = getPrimaryGuildForBotAlerts(client);

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
  await ensureDevIntelPrompt(firstGuild);

  try {
    await hydrateInviteCacheFromClient(client);
    console.log('[Referral] Invite use cache hydrated from guild.invites.fetch()');
  } catch (e) {
    console.error('[Referral] Startup hydrate failed:', e?.message || e);
  }

  setInterval(() => {
    cleanupExpiredApprovals().catch(err => {
      console.error('[ApprovalQueue] Interval cleanup failed:', err.message);
    });
  }, 60 * 1000);
});

client.on('guildMemberAdd', member => {
  Promise.resolve()
    .then(() => handleReferralGuildMemberAdd(member))
    .catch(err => {
      console.error('[Referral] guildMemberAdd handler:', err?.message || err);
    });
});

client.on('interactionCreate', async (interaction) => {
  try {
    const helpCustomId = interaction.customId || '';
    if (
      interaction.isStringSelectMenu() ||
      interaction.isButton()
    ) {
      if (
        helpCustomId === 'help_ui_category' ||
        helpCustomId === 'help_ui_topic' ||
        helpCustomId === 'help_ui_back_cats' ||
        helpCustomId.startsWith('help_ui_topics_')
      ) {
        const helpHandled = await handleHelpUiInteraction(interaction);
        if (helpHandled) return;
      }
    }

    if (interaction.isButton()) {
      if (await handleOhlcvTimeframeButton(interaction)) {
        return;
      }

      const parts = interaction.customId.split(':');

      if (interaction.customId === 'xverify_start') {
        await interaction.showModal(buildVerifyXHandleModal({ fromChannel: true }));
        return;
      }

      if (interaction.customId === 'dev_submit_start') {
        await interaction.showModal(buildDevSubmitModal());
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

const modChannel = getModChannel(interaction.guild);
const xApprovalChannel = getXApprovalChannel(interaction.guild);

if (modChannel) {
  await modChannel.send({
    embeds: [embed],
    components: buttons
  });
}

if (xApprovalChannel && (!modChannel || xApprovalChannel.id !== modChannel.id)) {
  await xApprovalChannel.send({
    embeds: [embed],
    components: buttons
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

  recordModAction({
    moderatorId: interaction.user.id,
    actionType: 'x_verify',
    dedupeKey: `interaction:${interaction.id}:xverify_accept:${userId}:${handle}`
  });

  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (member) {
    await assignXVerifiedRole(member);
  }

  const verifyChannel = findXVerifyTextChannel(interaction.guild);

  if (verifyChannel) {
    await verifyChannel.send(
      `✅ <@${userId}> has been verified as **@${handle}**`
    );
  }

  const xCompact = buildCompactXVerifyEmbed({
    resultLabel: 'Approved',
    moderatorUser: interaction.user,
    handle
  });
  await finalizeWithCompactEmbed(interaction, xCompact, 'x_verify');

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

      if (parts[0] === 'dev_sub_edit' && parts[1]) {
        if (!interaction.guild) {
          await interaction.reply({ content: '❌ Use this in a server.', ephemeral: true });
          return;
        }
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({
            content: '❌ You do not have permission to use this.',
            ephemeral: true
          });
          return;
        }
        if (interaction.channel?.name !== 'mod-approvals') {
          await interaction.reply({
            content: '❌ This action can only be used in #mod-approvals.',
            ephemeral: true
          });
          return;
        }
        const pending = await peekPendingDevSubmission(parts[1]);
        if (!pending) {
          await interaction.reply({
            content: 'This submission is no longer pending.',
            ephemeral: true
          });
          return;
        }
        await interaction.showModal(buildDevSubmissionEditModal(parts[1], pending));
        return;
      }

      if (parts[0] === 'dev_sub_approve' && parts[1]) {
        await handleDevSubmissionApprove(interaction, parts[1]);
        return;
      }

      if (parts[0] === 'dev_sub_deny' && parts[1]) {
        await handleDevSubmissionDeny(interaction, parts[1]);
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
            reply: async (payload) => interaction.followUp(payload)
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
            reply: async (payload) => interaction.followUp(payload)
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

      if (['approve_call', 'deny_call', 'exclude_call'].includes(action)) {
        // Require ManageGuild permission
        if (!interaction.memberPermissions?.has('ManageGuild')) {
          return interaction.reply({
            content: '❌ You do not have permission to use this.',
            ephemeral: true
          });
        }

        // Require correct channel
        if (interaction.channel?.name !== 'mod-approvals') {
          return interaction.reply({
            content: '❌ This action can only be used in #mod-approvals.',
            ephemeral: true
          });
        }
      }

      const trackedCall = getTrackedCall(contractAddress);
if (!trackedCall) {
  await interaction.reply({
    content: '❌ That tracked call could not be found.',
    ephemeral: true
  });
  return;
}

const mustMatchApprovalGuild = [
  'approve_call',
  'deny_call',
  'exclude_call',
  'tag_call',
  'note_call',
  'done_call'
];
if (
  mustMatchApprovalGuild.includes(action) &&
  trackedCall.approvalGuildId &&
  interaction.guildId &&
  trackedCall.approvalGuildId !== interaction.guildId
) {
  await interaction.reply({
    content: '❌ This approval request belongs to a different server.',
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
        await interaction.deferUpdate();

        updated = setApprovalStatus(contractAddress, 'approved', {
          moderatedById: interaction.user.id,
          moderatedByUsername: interaction.user.username
        });

        if (updated) {
          const approvalKind = resolveCoinDeletionKind(interaction.channel);
          recordModAction({
            moderatorId: interaction.user.id,
            actionType: approvalKind === 'premium' ? 'premium' : 'coin',
            dedupeKey: `interaction:${interaction.id}:approve_call:${contractAddress}`
          });
        }

        await publishApprovedCoinToX(contractAddress);

        const approvedCall = getTrackedCall(contractAddress);
        const approveEmbed = buildCompactCoinApprovalEmbed(approvedCall);
        const coinKind = resolveCoinDeletionKind(interaction.channel);
        await finalizeWithCompactEmbed(
          interaction,
          approveEmbed,
          coinKind === 'premium' ? 'premium' : 'coin'
        );

        return;
      }

      if (action === 'deny_call') {
        updated = setApprovalStatus(contractAddress, 'denied', {
          moderatedById: interaction.user.id,
          moderatedByUsername: interaction.user.username
        });

        if (updated) {
          recordModAction({
            moderatorId: interaction.user.id,
            actionType: 'coin_deny',
            dedupeKey: `interaction:${interaction.id}:deny_call:${contractAddress}`
          });
        }

        const deniedCall = getTrackedCall(contractAddress);
        const denyEmbed = buildCompactCoinApprovalEmbed(deniedCall);
        const denyKind = resolveCoinDeletionKind(interaction.channel);
        await finalizeWithCompactEmbed(
          interaction,
          denyEmbed,
          denyKind === 'premium' ? 'premium' : 'coin'
        );

        return;
      }

      if (action === 'exclude_call') {
        updated = setApprovalStatus(contractAddress, 'excluded', {
          moderatedById: interaction.user.id,
          moderatedByUsername: interaction.user.username
        });

        if (updated) {
          recordModAction({
            moderatorId: interaction.user.id,
            actionType: 'coin_exclude',
            dedupeKey: `interaction:${interaction.id}:exclude_call:${contractAddress}`
          });
        }

        await interaction.update({
          embeds: [buildApprovalStatusEmbed(getTrackedCall(contractAddress))],
          components: buildModerationFollowupButtons(contractAddress)
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
          clearApprovalRequest(contractAddress);
          const finalized = getTrackedCall(contractAddress) || latestTrackedCall;

          const doneEmbed = buildCompactCoinApprovalEmbed(finalized);
          const doneKind = resolveCoinDeletionKind(interaction.channel);
          await finalizeWithCompactEmbed(
            interaction,
            doneEmbed,
            doneKind === 'premium' ? 'premium' : 'coin'
          );
        } else {
          await interaction.update({
            content: '⚠️ Approve, deny, or exclude this coin before finishing.',
            embeds: [buildApprovalStatusEmbed(getTrackedCall(contractAddress) || latestTrackedCall)],
            components: buildModerationFollowupButtons(contractAddress)
          });
        }

        return;
      }
    }

    if (interaction.isModalSubmit()) {
      const parts = interaction.customId.split(':');

      if (
        interaction.customId === 'verify_x_handle_modal' ||
        interaction.customId === 'verify_x_handle_modal_channel'
      ) {
        const fromVerifyChannel = interaction.customId === 'verify_x_handle_modal_channel';

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

        const instructionContent = [
          `🧪 To verify ownership of **@${handle}**:`,
          '',
          `**Option 1:** Add this code to your X bio`,
          `**Option 2:** Post a tweet containing this code`,
          '',
          `**Verification Code:** \`${code}\``,
          '',
          `When you're done, click **Submit for Review** below.`,
          `A MOD will review and verify your request.`
        ].join('\n');

        const instructionComponents = buildXVerifySubmitButtons();

        if (fromVerifyChannel) {
          try {
            await interaction.user.send({
              content: instructionContent,
              components: instructionComponents
            });
            await interaction.reply({
              content: '✅ Check your DMs for verification instructions.',
              ephemeral: true
            });
          } catch (_) {
            await interaction.reply({
              content: ['Enable DMs and try again', '', instructionContent].join('\n'),
              components: instructionComponents,
              ephemeral: true
            });
          }
        } else {
          await interaction.reply({
            content: instructionContent,
            components: instructionComponents,
            ephemeral: true
          });
        }

        return;
      }

      if (interaction.customId === 'dev_submit_modal') {
        if (!interaction.guild) {
          await interaction.reply({
            content: '❌ Submit from inside a server.',
            ephemeral: true
          });
          return;
        }

        const nickname = interaction.fields.getTextInputValue('dev_sm_nick').trim();
        const coinsRaw = interaction.fields.getTextInputValue('dev_sm_coins');
        const walletsRaw = interaction.fields.getTextInputValue('dev_sm_wallets');
        const xHandle = interaction.fields.getTextInputValue('dev_sm_xhandle').trim().slice(0, 100);
        const notesRaw = interaction.fields.getTextInputValue('dev_sm_notes');
        const { tags, notes } = parseDevSubmitNotesAndTags(notesRaw);

        if (!nickname) {
          await interaction.reply({
            content: '❌ Dev name / nickname is required.',
            ephemeral: true
          });
          return;
        }

        const walletAddresses = parseCommaSeparatedAddresses(walletsRaw, isLikelySolWallet);
        const coinAddresses = parseCommaSeparatedAddresses(coinsRaw, isLikelySolWallet);

        if (!walletAddresses.length) {
          await interaction.reply({
            content:
              '❌ Add **at least one** valid Solana **wallet** (dev wallet). Put token mints under Coins (CAs), not Wallets.',
            ephemeral: true
          });
          return;
        }

        const submission = await createPendingDevSubmission({
          submitterId: interaction.user.id,
          submitterUsername: interaction.user.username,
          nickname,
          walletAddresses,
          coinAddresses,
          tags,
          notes,
          ...(xHandle ? { xHandle } : {})
        });

        const approvalsCh = getModApprovalsChannel(interaction.guild);
        if (!approvalsCh) {
          await takePendingDevSubmission(submission.id);
          await interaction.reply({
            content: '❌ **#mod-approvals** was not found. Ask an admin to create it.',
            ephemeral: true
          });
          return;
        }

        try {
          const modMsg = await approvalsCh.send({
            embeds: [buildDevSubmissionReviewEmbed(submission)],
            components: buildDevSubmissionReviewButtons(submission.id)
          });
          await updatePendingDevSubmission(submission.id, {
            approvalMessageId: modMsg.id,
            approvalChannelId: modMsg.channelId,
            approvalGuildId: interaction.guild.id
          });
        } catch (err) {
          console.error('[DevSubmission] Failed to post to mod-approvals:', err.message || err);
          await takePendingDevSubmission(submission.id);
          await interaction.reply({
            content: '❌ Could not post to **#mod-approvals**. Try again or contact an admin.',
            ephemeral: true
          });
          return;
        }

        await interaction.reply({
          content:
            '✅ Sent to **#mod-approvals** for review. Your dev is **not** added until a moderator approves.',
          ephemeral: true
        });

        return;
      }

      if (parts[0] === 'dev_sub_edit_modal' && parts[1]) {
        const submissionId = parts[1];

        if (!interaction.guild) {
          await interaction.reply({ content: '❌ Use this in a server.', ephemeral: true });
          return;
        }
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({
            content: '❌ You do not have permission to use this.',
            ephemeral: true
          });
          return;
        }
        if (interaction.channel?.name !== 'mod-approvals') {
          await interaction.reply({
            content: '❌ Open this from **#mod-approvals**.',
            ephemeral: true
          });
          return;
        }

        const existing = await peekPendingDevSubmission(submissionId);
        if (!existing) {
          await interaction.reply({
            content: 'This submission is no longer pending.',
            ephemeral: true
          });
          return;
        }

        const walletsRaw = interaction.fields.getTextInputValue('dev_ed_wallets');
        const coinsRaw = interaction.fields.getTextInputValue('dev_ed_coins');
        const tagsRaw = interaction.fields.getTextInputValue('dev_ed_tags');
        const xHandle = interaction.fields.getTextInputValue('dev_ed_xhandle').trim().slice(0, 100);
        const notes = interaction.fields.getTextInputValue('dev_ed_notes').trim();

        const walletAddresses = parseCommaSeparatedAddresses(walletsRaw, isLikelySolWallet);
        const coinAddresses = parseCommaSeparatedAddresses(coinsRaw, isLikelySolWallet);
        const tags = parseDevSubmitTags(tagsRaw);

        if (!walletAddresses.length) {
          await interaction.reply({
            content:
              '❌ Need **at least one** valid Solana wallet. Token mints belong in Coins (CAs).',
            ephemeral: true
          });
          return;
        }

        const updatedRow = await updatePendingDevSubmission(submissionId, {
          walletAddresses,
          coinAddresses,
          tags,
          notes,
          xHandle: xHandle || ''
        });

        const refreshed = await refreshDevSubmissionApprovalMessage(
          interaction.client,
          updatedRow || existing
        );

        await interaction.reply({
          content: refreshed
            ? '✅ Submission updated. **Approve** uses these values.'
            : '✅ Saved. Approve uses these values (embed could not be refreshed).',
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

  recordModAction({
    moderatorId: interaction.user.id,
    actionType: 'x_verify_deny',
    dedupeKey: `interaction:${interaction.id}:xverify_deny_modal:${userId}:${handle}`
  });

  clearXVerifySessionsForUser(userId);

  const verifyChannel = findXVerifyTextChannel(interaction.guild);
  if (verifyChannel) {
    await verifyChannel.send(`❌ <@${userId}>, your X verification for **@${handle}** was denied.\n**Reason:** ${reason}`);
  }

  const xDenyCompact = buildCompactXVerifyEmbed({
    resultLabel: 'Denied',
    moderatorUser: interaction.user,
    handle
  });
  await finalizeWithCompactEmbed(interaction, xDenyCompact, 'x_verify');
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

      if (
        trackedCall.approvalGuildId &&
        interaction.guildId &&
        trackedCall.approvalGuildId !== interaction.guildId
      ) {
        await interaction.reply({
          content: '❌ This approval request belongs to a different server.',
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

        const afterTag = getTrackedCall(contractAddress);
        await interaction.update({
          embeds: [buildApprovalStatusEmbed(afterTag)],
          components: buildModerationFollowupButtons(contractAddress)
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

        const afterNote = getTrackedCall(contractAddress);
        await interaction.update({
          embeds: [buildApprovalStatusEmbed(afterNote)],
          components: buildModerationFollowupButtons(contractAddress)
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
        if (message.author.id !== process.env.BOT_OWNER_ID) {
          return message.reply('❌ You do not have permission to use this command.');
        }

        const result = await createPost('Test post from McGBot 🚀');

        if (result.success) {
          await replyText(message, `✅ Posted to X\nPost ID: ${result.id}`);
        } else {
          await replyText(message, `❌ Failed to post to X\n${JSON.stringify(result.error, null, 2)}`);
        }

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

        recordModAction({
          moderatorId: message.author.id,
          actionType: 'x_verify',
          dedupeKey: `message:${message.id}:verifyx:${mentionedUser.id}:${pendingHandle}`
        });

        const member = await message.guild.members.fetch(mentionedUser.id).catch(() => null);
        if (member) {
          await assignXVerifiedRole(member);
        }

        const verifyChannel = findXVerifyTextChannel(message.guild);

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

      if (lowerContent === '!referral') {
        if (!message.guild) {
          await replyText(message, '❌ Use `!referral` in a server.');
          return;
        }

        try {
          const userId = message.author.id;
          const invite = await getOrCreateUserReferral(userId, message.guild);
          const stats = await getReferralStatsForReferrer(userId);
          const embed = createReferralCommandEmbed({
            inviteUrl: invite.url || '',
            total: stats.total,
            last24h: stats.last24h,
            last7d: stats.last7d,
            last30d: stats.last30d
          });

          await message.reply({
            embeds: [embed],
            allowedMentions: { repliedUser: false }
          });
        } catch (err) {
          console.error('[Referral] !referral command failed:', err?.message || err);
          await replyText(message, '❌ Could not load your referral info. Try again later.');
        }

        return;
      }

      if (lowerContent === '!refboard') {
        if (!message.guild) {
          await replyText(message, '❌ Use `!refboard` in a server.');
          return;
        }

        try {
          const entries = await getReferralLeaderboardTop(message.guild, client, 10);
          const embed = createReferralLeaderboardEmbed(entries);

          await message.reply({
            embeds: [embed],
            allowedMentions: { repliedUser: false }
          });
        } catch (err) {
          console.error('[Referral] !refboard failed:', err?.message || err);
          await replyText(message, '❌ Could not load the referral leaderboard. Try again later.');
        }

        return;
      }

      const devLookupParts = content.split(/\s+/).filter(Boolean);
      const devLookupCmd = devLookupParts[0] ? devLookupParts[0].toLowerCase() : '';

      if (devLookupCmd === '!devcard') {
        const query = devLookupParts.slice(1).join(' ').trim();
        if (!query) {
          await replyText(message, '❌ Usage: `!devcard <wallet | @nickname | nickname>`');
          return;
        }

        const matches = findTrackedDevsByLookup(query);
        if (!matches.length) {
          await replyText(message, '❌ No tracked dev matched that query.');
          return;
        }
        if (matches.length > 1) {
          const lines = matches
            .slice(0, 10)
            .map(d =>
              d.nickname
                ? `• **${d.nickname}** — \`${d.walletAddress}\``
                : `• \`${d.walletAddress}\``
            )
            .join('\n');
          await replyText(
            message,
            `Several devs matched — narrow it down:\n${lines}${matches.length > 10 ? '\n…' : ''}`
          );
          return;
        }

        const dev = matches[0];
        await message.reply({
          embeds: [
            createDevCheckEmbed({
              walletAddress: dev.walletAddress,
              trackedDev: dev,
              checkedBy: message.author.username,
              contextLabel: 'Dev Card',
              rankData: getDevRankData(dev),
              showDevEditMenu: false,
              compactCard: true
            })
          ],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (devLookupCmd === '!dev') {
        const query = devLookupParts.slice(1).join(' ').trim();
        if (!query) {
          await replyText(message, '❌ Usage: `!dev <wallet | @nickname | nickname>`');
          return;
        }

        const matches = findTrackedDevsByLookup(query);
        if (!matches.length) {
          await replyText(message, '❌ No tracked dev matched that query.');
          return;
        }
        if (matches.length > 1) {
          const lines = matches
            .slice(0, 10)
            .map(d =>
              d.nickname
                ? `• **${d.nickname}** — \`${d.walletAddress}\``
                : `• \`${d.walletAddress}\``
            )
            .join('\n');
          await replyText(
            message,
            `Several devs matched — narrow it down:\n${lines}${matches.length > 10 ? '\n…' : ''}`
          );
          return;
        }

        const dev = matches[0];
        await message.reply({
          embeds: [
            createDevCheckEmbed({
              walletAddress: dev.walletAddress,
              trackedDev: dev,
              checkedBy: message.author.username,
              contextLabel: 'Dev Lookup',
              rankData: getDevRankData(dev),
              showDevEditMenu: false,
              compactCard: false
            })
          ],
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

if (lowerContent === '!guide') {
  await handleGuideCommand(message, {
    memberCanManageGuild,
    isBotOwner,
    splitDiscordMessage
  });
  return;
}

if (lowerContent === '!commands') {
  const contentOut = buildMcgbotCommandListText(message, {
    memberCanManageGuild,
    isBotOwner
  });
  const chunks = splitDiscordMessage(contentOut, 2000).filter(
    c => String(c || '').length > 0
  );

  try {
    for (let i = 0; i < chunks.length; i++) {
      await message.author.send({
        content: chunks[i],
        allowedMentions: { parse: [] }
      });
    }
  } catch (_err) {
    await message.reply({
      content: DM_BLOCKED_COMMAND_LIST_REPLY,
      allowedMentions: { repliedUser: false }
    });
  }

  return;
}

if (lowerContent === '!faq') {
  await handleFaqCommand(message, splitDiscordMessage);
  return;
}

if (lowerContent === '!help' || lowerContent.startsWith('!help ')) {
  await handleInteractiveHelp(message, content, { splitDiscordMessage });
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

  const X_LIST_CAP = 8;
  const BOT_LIST_CAP = 8;

  const pendingX = getPendingXVerifications(X_LIST_CAP);

  const pendingBot = getPendingApprovals(50).filter(
    c =>
      c.callSourceType === 'bot_call' &&
      String(c.approvalStatus || '').toLowerCase() === 'pending' &&
      c.isActive !== false &&
      String(c.lifecycleStatus || 'active').toLowerCase() !== 'archived'
  );

  const xLines = pendingX.map((profile, index) => {
    const displayName =
      profile.preferredPublicName ||
      profile.username ||
      profile.discordUsername ||
      `User ${index + 1}`;

    const handle = profile?.xVerification?.requestedHandle
      ? `@${String(profile.xVerification.requestedHandle).replace(/^@/, '')}`
      : 'Unknown';

    let minutes = 0;
    if (profile?.xVerification?.requestedAt) {
      const diff =
        Date.now() - new Date(profile.xVerification.requestedAt).getTime();
      minutes = Math.floor(diff / 60000);
    }

    return `${index + 1}. **${displayName}** • ${handle} • ${minutes}m ago`;
  });

  const rankedBot = [...pendingBot]
    .map(call => {
      const entry = Number(call.firstCalledMarketCap || call.marketCap || 0);
      const current = Number(call.latestMarketCap || call.marketCap || 0);
      const mult = entry > 0 ? current / entry : 0;

      return { call, mult };
    })
    .sort((a, b) => b.mult - a.mult)
    .slice(0, BOT_LIST_CAP);

  const botLines = rankedBot.map((item, index) => {
    const call = item.call;
    const token = call.tokenName || 'Unknown';
    const ticker = call.ticker ? `$${call.ticker}` : '';

    return `${index + 1}. **${token}** ${ticker} • **${item.mult.toFixed(2)}x**`;
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
          migrated: trackedCall.migrated === true,
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

      recordModAction({
        moderatorId: message.author.id,
        actionType: 'dev',
        dedupeKey: `message:${message.id}:addTrackedDev:${wallet}`
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

(async function startBot() {
  try {
    const { initUserProfilesStore } = require('./utils/userProfileService');
    const { initTrackedDevsStore } = require('./utils/devRegistryService');
    const { initScannerSettingsStore } = require('./utils/scannerSettingsService');
    const { initTrackedCallsStore } = require('./utils/trackedCallsService');
    const { initHelpTopicsFromDisk } = require('./utils/helpMatcher');

    await initUserProfilesStore();
    await initTrackedDevsStore();
    await initScannerSettingsStore();
    await initTrackedCallsStore();
    await initHelpTopicsFromDisk();

    BOT_SETTINGS = await hydrateBotSettingsFromDisk();
    SCANNER_ENABLED = BOT_SETTINGS.scannerEnabled !== false;
  } catch (err) {
    console.error('[Startup] Failed to initialize JSON data stores:', err);
    process.exitCode = 1;
    return;
  }

  startReferralApiServer();
  client.login(process.env.DISCORD_TOKEN);
})();