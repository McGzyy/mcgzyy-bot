require('dotenv').config();

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

const { startMonitoring } = require('./utils/monitoringEngine');
const { startAutoCallEngine } = require('./utils/autoCallEngine');
const { createPost } = require('./utils/xPoster');

const { generateRealScan } = require('./utils/scannerEngine');
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
  getCallerLeaderboard,
  getTopCallerInTimeframe,
  getBestCallInTimeframe,
  getBestBotCallInTimeframe
} = require('./utils/callerStatsService');

const {
  getTrackedCall,
  saveTrackedCall,
  setApprovalStatus,
  setApprovalMessageMeta,
  markApprovalRequested,
  clearApprovalRequest,
  getAllTrackedCalls,
  addModerationTag,
  setModerationNotes,
  setXPostState
} = require('./utils/trackedCallsService');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const devEditSessions = new Map();
const DEV_EDIT_SESSION_TTL_MS = 10 * 60 * 1000;

// TESTING APPROVAL ENTRY THRESHOLD
const APPROVAL_TRIGGER_X = 4;

// ACTUAL X / APPROVAL MILESTONE LADDER
const APPROVAL_MILESTONE_LADDER = [4, 8, 16, 32, 64, 100];

const APPROVAL_EXPIRY_MINUTES = 20;

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

async function replyText(message, content) {
  await message.reply({
    content,
    allowedMentions: { repliedUser: false }
  });
}

function getApprovalChannel(guild) {
  if (!guild) return null;

  return guild.channels.cache.find(
    ch =>
      ch &&
      ch.isTextBased &&
      typeof ch.isTextBased === 'function' &&
      ch.isTextBased() &&
      (ch.name === 'coin-approval' || ch.name === 'coin-approvals')
  ) || null;
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

function getCurrentX(trackedCall) {
  const ath = Number(
    trackedCall.ath ||
    trackedCall.athMc ||
    trackedCall.athMarketCap ||
    trackedCall.latestMarketCap ||
    trackedCall.firstCalledMarketCap ||
    0
  );

  const firstCalledMc = Number(trackedCall.firstCalledMarketCap || 0);
  if (firstCalledMc <= 0) return 0;

  return ath / firstCalledMc;
}

function getHighestEligibleApprovalMilestone(currentX) {
  const eligible = APPROVAL_MILESTONE_LADDER.filter(x => currentX >= x);
  if (!eligible.length) return 0;
  return Math.max(...eligible);
}

function shouldCreateApprovalRequest(trackedCall) {
  if (!trackedCall) return { shouldSend: false, triggerX: 0 };

  const currentX = getCurrentX(trackedCall);
  if (currentX < APPROVAL_TRIGGER_X) {
    return { shouldSend: false, triggerX: 0 };
  }

  const nextMilestone = getHighestEligibleApprovalMilestone(currentX);
  if (!nextMilestone) {
    return { shouldSend: false, triggerX: 0 };
  }

  const alreadyTriggered = Array.isArray(trackedCall.approvalMilestonesTriggered)
    ? trackedCall.approvalMilestonesTriggered.includes(nextMilestone)
    : false;

  const currentlyPending = trackedCall.approvalMessageId && trackedCall.approvalStatus === 'pending';

  if (currentlyPending && Number(trackedCall.lastApprovalTriggerX || 0) >= nextMilestone) {
    return { shouldSend: false, triggerX: 0 };
  }

  if (alreadyTriggered && Number(trackedCall.lastApprovalTriggerX || 0) >= nextMilestone) {
    return { shouldSend: false, triggerX: 0 };
  }

  return { shouldSend: true, triggerX: nextMilestone };
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
  const x = firstCalledMc > 0 ? ath / firstCalledMc : 0;

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

  const descriptionLines = [
    `**Status:** ${statusLabel}`,
    `**Caller:** ${trackedCall.firstCallerDisplayName || trackedCall.firstCallerUsername || 'Unknown'}`,
    `**CA:** \`${ca}\``,
    `**Links:** ${links}`,
    '',
    `**First Called MC:** ${formatUsd(firstCalledMc)}`,
    `**Current / Latest MC:** ${formatUsd(trackedCall.latestMarketCap)}`,
    `**ATH MC:** ${formatUsd(ath)}`,
    `**From Call:** ${formatX(x)}`,
    `**Approval Trigger:** ${formatX(trackedCall.lastApprovalTriggerX)}`,
    '',
    `**Excluded From Stats:** ${trackedCall.excludedFromStats ? 'Yes' : 'No'}`,
    `**Tags:** ${tags}`,
    `**Notes:** ${trackedCall.moderationNotes || 'None'}`
  ];

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

function buildXPostText(trackedCall, milestoneX, isReply = false) {
  const ticker = trackedCall.ticker || 'UNKNOWN';
  const ca = trackedCall.contractAddress;
  const caller = trackedCall.firstCallerDisplayName || trackedCall.firstCallerUsername || 'Unknown';
  const athMc = formatUsd(
    trackedCall.ath ||
    trackedCall.athMc ||
    trackedCall.athMarketCap ||
    trackedCall.latestMarketCap ||
    trackedCall.firstCalledMarketCap ||
    0
  );

  if (!isReply) {
    return [
      `📊 $${ticker} just reached ${milestoneX}x from call.`,
      ``,
      `Called by: ${caller}`,
      `ATH Market Cap: ${athMc}`,
      `Contract: ${ca}`,
      ``,
      `Tracked by MCGZYY Bot`
    ].join('\n');
  }

  return [
    `📈 $${ticker} has now reached ${milestoneX}x from call.`,
    ``,
    `ATH Market Cap: ${athMc}`,
    `CA: In OP`
  ].join('\n');
}

async function publishApprovedCoinToX(contractAddress) {
  const trackedCall = getTrackedCall(contractAddress);
  if (!trackedCall) return { success: false, reason: 'missing_call' };
  if (!trackedCall.xApproved) return { success: false, reason: 'not_approved' };

  const currentX = getCurrentX(trackedCall);
  const milestoneX = getHighestEligibleApprovalMilestone(currentX);

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

  const postText = buildXPostText(trackedCall, milestoneX, hasOriginal);
  const result = await createPost(postText, hasOriginal ? trackedCall.xOriginalPostId : null);

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

async function postApprovalReview(guild, trackedCall, scan = null, triggerX = 0) {
  try {
    const approvalChannel = getApprovalChannel(guild);
    if (!approvalChannel) return null;

    if (trackedCall.approvalMessageId) {
      await deleteApprovalMessage(guild, trackedCall);
      clearApprovalRequest(trackedCall.contractAddress);
    }

    const expiresAt = new Date(Date.now() + APPROVAL_EXPIRY_MINUTES * 60 * 1000).toISOString();
    const refreshed = markApprovalRequested(trackedCall.contractAddress, triggerX, expiresAt);

    const embed = buildApprovalStatusEmbed(refreshed, scan);
    const buttons = buildApprovalButtons(trackedCall.contractAddress);

    const sent = await approvalChannel.send({
      embeds: [embed],
      components: buttons
    });

    setApprovalMessageMeta(trackedCall.contractAddress, sent.id, approvalChannel.id);

    return sent.id;
  } catch (error) {
    console.error('[ApprovalQueue] Failed to post approval review:', error.message);
    return null;
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

async function maybeQueueApproval(guild, trackedCall, scan = null) {
  const { shouldSend, triggerX } = shouldCreateApprovalRequest(trackedCall);
  if (!shouldSend) return false;

  await postApprovalReview(guild, trackedCall, scan, triggerX);
  return true;
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

client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  const guilds = client.guilds.cache;
  const firstGuild = guilds.first();

  if (!firstGuild) {
    console.log('❌ No guild found for monitoring alerts.');
    return;
  }

  const channels = firstGuild.channels.cache.filter(channel => channel.isTextBased());
  const firstTextChannel = channels.first();

  if (!firstTextChannel) {
    console.log('❌ No text channel found for alerts.');
    return;
  }

  console.log(`📡 Alerts will post in: #${firstTextChannel.name}`);

  const trackedDevs = getAllTrackedDevs();
  console.log(`[DevTracker] Loaded ${trackedDevs.length} tracked dev(s).`);

  startMonitoring(firstTextChannel, 60000);
  startAutoCallEngine(firstTextChannel);

  setInterval(() => {
    cleanupExpiredApprovals().catch(err => {
      console.error('[ApprovalQueue] Interval cleanup failed:', err.message);
    });
  }, 60 * 1000);
});

client.on('interactionCreate', async (interaction) => {
  try {
    /**
     * =========================
     * BUTTONS
     * =========================
     */
    if (interaction.isButton()) {
      const [action, contractAddress] = interaction.customId.split(':');
      if (!action || !contractAddress) return;

      /**
       * =========================
       * CALL / WATCH BUTTONS
       * =========================
       */
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

      /**
       * =========================
       * MODERATION BUTTONS
       * =========================
       */
      const trackedCall = getTrackedCall(contractAddress);
      if (!trackedCall) {
        await interaction.reply({
          content: '❌ That tracked call could not be found.',
          ephemeral: true
        });
        return;
      }

      let updated = null;

      if (action === 'approve_call') {
        updated = setApprovalStatus(contractAddress, 'approved', {
          id: interaction.user.id,
          username: interaction.user.username
        });

        const xResult = await publishApprovedCoinToX(contractAddress);

        await refreshApprovalMessage(interaction.guild, contractAddress);

        let publishLine = '';
        if (xResult.success) {
          publishLine = xResult.reply
            ? `\n📤 Posted update reply to X at **${xResult.milestoneX}x**`
            : `\n📤 Posted original X thread at **${xResult.milestoneX}x**`;
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
          id: interaction.user.id,
          username: interaction.user.username
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
          id: interaction.user.id,
          username: interaction.user.username
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

    /**
     * =========================
     * MODALS
     * =========================
     */
    if (interaction.isModalSubmit()) {
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
    const channelName = message.channel?.name || '';

    const handledSession = await handleDevSessionReply(message);
    if (handledSession) return;

    if (content.startsWith('!')) {
      if (content.toLowerCase() === '!testx') {
        const result = await createPost('Test post from McGBot 🚀');

        if (result.success) {
          await replyText(message, `✅ Posted to X\nPost ID: ${result.id}`);
        } else {
          await replyText(message, `❌ Failed to post to X\n${JSON.stringify(result.error, null, 2)}`);
        }

        return;
      }

      if (content.toLowerCase() === '!devleaderboard') {
        const leaderboard = getDevLeaderboard(10);
        const embed = createDevLeaderboardEmbed(leaderboard);

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (content.toLowerCase().startsWith('!caller ')) {
        const username = content.replace(/^!caller\s+/i, '').trim();

        if (!username) {
          await replyText(message, '❌ Usage: `!caller <username>`');
          return;
        }

        const stats = getCallerStats(username);
        const embed = createCallerCardEmbed(stats);

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (content.toLowerCase() === '!callerboard') {
        const leaderboard = getCallerLeaderboard(10);
        const embed = createCallerLeaderboardEmbed(leaderboard);

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (content.toLowerCase() === '!bestcall24h') {
        const best = getBestCallInTimeframe(1);
        const embed = createSingleCallEmbed(best, '🏆 BEST USER CALL — LAST 24 HOURS');

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (content.toLowerCase() === '!bestcallweek') {
        const best = getBestCallInTimeframe(7);
        const embed = createSingleCallEmbed(best, '🏆 BEST USER CALL — LAST 7 DAYS');

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (content.toLowerCase() === '!bestcallmonth') {
        const best = getBestCallInTimeframe(30);
        const embed = createSingleCallEmbed(best, '🏆 BEST USER CALL — LAST 30 DAYS');

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (content.toLowerCase() === '!topcaller24h') {
        const top = getTopCallerInTimeframe(1);
        const embed = createTopCallerTimeframeEmbed(top, '👤 TOP CALLER — LAST 24 HOURS');

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (content.toLowerCase() === '!topcallerweek') {
        const top = getTopCallerInTimeframe(7);
        const embed = createTopCallerTimeframeEmbed(top, '👤 TOP CALLER — LAST 7 DAYS');

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (content.toLowerCase() === '!topcallermonth') {
        const top = getTopCallerInTimeframe(30);
        const embed = createTopCallerTimeframeEmbed(top, '👤 TOP CALLER — LAST 30 DAYS');

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (content.toLowerCase() === '!bestbot24h') {
        const best = getBestBotCallInTimeframe(1);
        const embed = createSingleCallEmbed(best, '🤖 BEST BOT CALL — LAST 24 HOURS');

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (content.toLowerCase() === '!bestbotweek') {
        const best = getBestBotCallInTimeframe(7);
        const embed = createSingleCallEmbed(best, '🤖 BEST BOT CALL — LAST 7 DAYS');

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (content.toLowerCase() === '!bestbotmonth') {
        const best = getBestBotCallInTimeframe(30);
        const embed = createSingleCallEmbed(best, '🤖 BEST BOT CALL — LAST 30 DAYS');

        await message.reply({
          embeds: [embed],
          allowedMentions: { repliedUser: false }
        });

        return;
      }

      if (content.toLowerCase().startsWith('!addlaunch ')) {
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
      // IMPORTANT:
      // Raw CA handling is now fully delegated to basicCommands.js
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