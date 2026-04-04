const { generateRealScan } = require('./scannerEngine');
const {
  getAllTrackedCalls,
  updateTrackedCallData,
  getTrackedCall,
  clearApprovalRequest,
  setApprovalStatus,
  setXPostState
} = require('./trackedCallsService');
const {
  getApprovalTriggerX,
  getHighestEligibleApprovalMilestone,
  shouldCreateApprovalRequest
} = require('./approvalMilestoneService');
const {
  createMilestoneEmbed,
  createDumpEmbed
} = require('./alertEmbeds');
const { enqueueAlert } = require('./alertQueue');
const { createPost } = require('./xPoster');
const { resolvePublicCallerName } = require('./userProfileService');
const { buildXPostTextMonitor } = require('./xPostContent');
const {
  determineLifecycleStatus,
  getLifecycleChangeReason
} = require('./lifecycleEngine');

let monitoringInterval = null;
let isRunning = false;

/**
 * =========================
 * CONFIG
 * =========================
 */

// Discord alert ladder
const DISCORD_MILESTONE_LEVELS = [
  { key: '2x', x: 2, threshold: 100 },
  { key: '4x', x: 4, threshold: 300 },
  { key: '8x', x: 8, threshold: 700 },
  { key: '16x', x: 16, threshold: 1500 },
  { key: '32x', x: 32, threshold: 3100 },
  { key: '64x', x: 64, threshold: 6300 },
  { key: '100x', x: 100, threshold: 9900 }
];

const APPROVAL_EXPIRY_MINUTES = 20;

// Top approval pool size
const MAX_ACTIVE_APPROVALS = 3;

/**
 * =========================
 * HELPERS
 * =========================
 */

function calculatePerformancePercent(firstMc, currentMc) {
  if (!firstMc || !currentMc || firstMc <= 0) return null;
  return ((currentMc - firstMc) / firstMc) * 100;
}

function calculateDrawdownPercent(athMc, currentMc) {
  if (!athMc || !currentMc || athMc <= 0) return null;
  return ((currentMc - athMc) / athMc) * 100;
}

function calculateCurrentX(firstMc, athMc) {
  if (!firstMc || !athMc || firstMc <= 0) return 0;
  return athMc / firstMc;
}

function formatX(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 'N/A';
  return `${num.toFixed(2)}x`;
}

function formatUsd(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'N/A';
  return `$${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function getPublicCallerLabel(trackedCall, fallback = 'Unknown') {
  if (!trackedCall) return fallback;

  if (trackedCall.callSourceType === 'bot_call') {
    return 'McGBot';
  }

  if (trackedCall.callSourceType === 'watch_only') {
    return (
      trackedCall.firstCallerPublicName ||
      trackedCall.firstCallerDisplayName ||
      trackedCall.firstCallerUsername ||
      fallback
    );
  }

  return resolvePublicCallerName({
    discordUserId: trackedCall.firstCallerDiscordId || trackedCall.firstCallerId || null,
    username: trackedCall.firstCallerUsername || '',
    displayName: trackedCall.firstCallerDisplayName || '',
    trackedCall,
    fallback:
      trackedCall.firstCallerPublicName ||
      trackedCall.firstCallerDisplayName ||
      trackedCall.firstCallerUsername ||
      fallback
  });
}

/**
 * =========================
 * X POST HELPERS
 * =========================
 */

async function maybePublishApprovedMilestoneToX(trackedCall) {
  try {
    if (!trackedCall || !trackedCall.xApproved) {
      return { success: false, reason: 'not_approved' };
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
    const currentX = firstCalledMc > 0 ? ath / firstCalledMc : 0;

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

    const postText = buildXPostTextMonitor(trackedCall, milestoneX, hasOriginal);
    const result = await createPost(
      postText,
      hasOriginal ? trackedCall.xOriginalPostId : null
    );

    if (!result.success || (!result.dryRun && !result.id)) {
      return {
        success: false,
        reason: 'x_post_failed',
        error: result.error || null
      };
    }

    if (result.dryRun) {
      console.log(
        `[X AutoThread] DRY RUN — would post ${hasOriginal ? 'reply' : 'original'} for ${trackedCall.tokenName || trackedCall.contractAddress} at ${milestoneX}x`
      );
      return {
        success: true,
        dryRun: true,
        milestoneX,
        reply: hasOriginal,
        postId: null
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

    setXPostState(trackedCall.contractAddress, updates);

    console.log(
      `[X AutoThread] Posted ${hasOriginal ? 'reply' : 'original'} for ${trackedCall.tokenName || trackedCall.contractAddress} at ${milestoneX}x`
    );

    return {
      success: true,
      milestoneX,
      reply: hasOriginal,
      postId: result.id
    };
  } catch (error) {
    console.error('[X AutoThread] Failed to publish approved milestone:', error.message);
    return {
      success: false,
      reason: 'exception',
      error: error.message
    };
  }
}

/**
 * =========================
 * DISCORD MILESTONES
 * =========================
 */
function getNewMilestones(perf, milestonesHit = []) {
  if (perf === null) return [];

  return DISCORD_MILESTONE_LEVELS.filter(m =>
    perf >= m.threshold && !milestonesHit.includes(m.key)
  );
}

/**
 * =========================
 * DUMPS (SMART)
 * =========================
 */
function getHighestDump(drawdown, hits = []) {
  if (drawdown === null) return null;

  const levels = [
    { key: '-55%', threshold: -55 },
    { key: '-35%', threshold: -35 }
  ];

  for (const level of levels) {
    if (drawdown <= level.threshold && !hits.includes(level.key)) {
      return level;
    }
  }

  return null;
}

/**
 * =========================
 * APPROVAL QUEUE HELPERS
 * =========================
 */

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
  const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
  } = require('discord.js');

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

function buildApprovalStatusEmbed(trackedCall, scan = null) {
  const { EmbedBuilder } = require('discord.js');

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

  const callerLabel = getPublicCallerLabel(trackedCall, 'Unknown');

  const embed = new EmbedBuilder()
    .setColor(
      status === 'approved' ? 0x22c55e :
      status === 'denied' ? 0xef4444 :
      status === 'excluded' ? 0x64748b :
      status === 'expired' ? 0x94a3b8 :
      0xf59e0b
    )
    .setTitle(`🧪 COIN APPROVAL REVIEW — ${trackedCall.tokenName || 'Unknown Token'} ($${trackedCall.ticker || 'UNKNOWN'})`)
    .setDescription(
      [
        `**Status:** ${statusLabel}`,
        `**Caller:** ${callerLabel}`,
        `**CA:** \`${trackedCall.contractAddress}\``,
        '',
        `**First Called MC:** ${formatUsd(firstCalledMc)}`,
        `**Current / Latest MC:** ${formatUsd(trackedCall.latestMarketCap)}`,
        `**ATH MC:** ${formatUsd(ath)}`,
        `**ATH X:** ${formatX(x)}`,
        `**Approval Trigger:** ${formatX(trackedCall.lastApprovalTriggerX)}`,
        '',
        `**Excluded From Stats:** ${trackedCall.excludedFromStats ? 'Yes' : 'No'}`,
        `**Tags:** ${tags}`,
        `**Notes:** ${trackedCall.moderationNotes || 'None'}`
      ].join('\n')
    )
    .setFooter({
      text: trackedCall.moderatedByUsername
        ? `Last moderated by ${trackedCall.moderatedByUsername}`
        : 'Awaiting mod review'
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

async function deleteApprovalMessage(guild, trackedCall) {
  try {
    if (!trackedCall?.approvalChannelId || !trackedCall?.approvalMessageId || !guild) return;

    const channel = guild.channels.cache.get(trackedCall.approvalChannelId);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(trackedCall.approvalMessageId).catch(() => null);
    if (!message) return;

    await message.delete().catch(() => null);
  } catch (error) {
    console.error('[ApprovalQueue] Failed to delete approval message:', error.message);
  }
}

function getActivePendingApprovals() {
  const approvalTriggerX = getApprovalTriggerX();

return getAllTrackedCalls()
  .filter(call =>
    call.approvalStatus === 'pending' &&
    call.approvalMessageId &&
    Number(call.lastApprovalTriggerX || 0) >= approvalTriggerX
  )
    .sort((a, b) => {
      const ax = Number(a.lastApprovalTriggerX || 0);
      const bx = Number(b.lastApprovalTriggerX || 0);

      if (bx !== ax) return bx - ax;

      const aTime = new Date(a.approvalRequestedAt || 0).getTime();
      const bTime = new Date(b.approvalRequestedAt || 0).getTime();

      return bTime - aTime;
    });
}

async function pruneApprovalPool(guild) {
  const active = getActivePendingApprovals();

  if (active.length <= MAX_ACTIVE_APPROVALS) return;

  const keep = active.slice(0, MAX_ACTIVE_APPROVALS);
  const remove = active.slice(MAX_ACTIVE_APPROVALS);

  const keepSet = new Set(keep.map(c => c.contractAddress));

  for (const trackedCall of remove) {
    if (keepSet.has(trackedCall.contractAddress)) continue;

    await deleteApprovalMessage(guild, trackedCall);

    setApprovalStatus(trackedCall.contractAddress, 'expired');
    clearApprovalRequest(trackedCall.contractAddress);

    console.log(
      `[ApprovalQueue] Pruned weaker approval: ${trackedCall.tokenName || trackedCall.contractAddress} (${trackedCall.lastApprovalTriggerX}x)`
    );
  }
}

async function postApprovalReview(channel, trackedCall, scan = null, triggerX = 0) {
  try {
    const guild = channel.guild;
    const approvalChannel = getApprovalChannel(guild);
    if (!approvalChannel) return null;

    const {
      markApprovalRequested,
      setApprovalMessageMeta,
      clearApprovalRequest
    } = require('./trackedCallsService');

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

    console.log(
      `[ApprovalQueue] Queued ${trackedCall.tokenName || trackedCall.contractAddress} for ${triggerX}x approval`
    );

    await pruneApprovalPool(guild);

    return sent.id;
  } catch (error) {
    console.error('[ApprovalQueue] Failed to post approval review:', error.message);
    return null;
  }
}

function queueApprovalReview(channel, trackedCall, scan, triggerX) {
  enqueueAlert(async () => {
    await postApprovalReview(channel, trackedCall, scan, triggerX);
  }, {
    type: 'milestone',
    contractAddress: trackedCall.contractAddress,
    key: `approval_${triggerX}x`
  });
}

/**
 * =========================
 * REPLY TARGET HELPER
 * =========================
 */
function buildReplyOptions(coin) {
  if (!coin?.discordMessageId) return {};

  return {
    reply: {
      messageReference: coin.discordMessageId,
      failIfNotExists: false
    }
  };
}

/**
 * =========================
 * ALERT SENDERS (QUEUED)
 * =========================
 */

function queueMilestone(channel, coin, scan, key, perf) {
  enqueueAlert(async () => {
    const replyOptions = buildReplyOptions(coin);

    await channel.send({
      embeds: [createMilestoneEmbed(coin, scan, key, perf)],
      ...replyOptions
    });
  }, {
    type: 'milestone',
    contractAddress: coin.contractAddress,
    key
  });
}

function queueDump(channel, coin, scan, key, drawdown) {
  enqueueAlert(async () => {
    const replyOptions = buildReplyOptions(coin);

    await channel.send({
      embeds: [createDumpEmbed(coin, scan, key, drawdown)],
      ...replyOptions
    });
  }, {
    type: 'dump',
    contractAddress: coin.contractAddress,
    key
  });
}

/**
 * =========================
 * MAIN LOOP
 * =========================
 */

async function checkTrackedCoins(channel) {
  const tracked = getAllTrackedCalls();

  console.log(`[Monitor] Checking ${tracked.length} coins`);

  for (const coin of tracked) {
    try {
      const scan = await generateRealScan(coin.contractAddress);

      if (!scan || !scan.marketCap || scan.marketCap <= 0) {
  const failedScans = Number(coin.failedScans || 0) + 1;

  updateTrackedCallData(coin.contractAddress, {
    failedScans,
    lastUpdatedAt: new Date().toISOString()
  });

  if (failedScans >= 3) {
    updateTrackedCallData(coin.contractAddress, {
      lifecycleStatus: 'archived',
      isActive: false,
      failedScans,
      lastUpdatedAt: new Date().toISOString()
    });

    console.log(
      `[Monitor] Archived ${coin.tokenName || coin.contractAddress} -> repeated failed scans (${failedScans})`
    );
  } else {
    console.log(
      `[Monitor] ${coin.tokenName || coin.contractAddress} -> scan failed (${failedScans}/3)`
    );
  }

  continue;
}

      const currentMc = scan.marketCap;
      const firstMc = coin.firstCalledMarketCap || currentMc;
      const athMc = Math.max(coin.athMc || firstMc, currentMc);

      const perf = calculatePerformancePercent(firstMc, currentMc);
const drawdown = calculateDrawdownPercent(athMc, currentMc);
const currentX = calculateCurrentX(firstMc, athMc);

let lifecycleStatus = determineLifecycleStatus(coin, scan);
let forceArchiveReason = null;

// HARD KILL RULES for main scanner
if (currentMc < 5000) {
  lifecycleStatus = 'archived';
  forceArchiveReason = `Hard archived: market cap fell below $5k (${formatUsd(currentMc)})`;
} else if (perf !== null && perf <= -80) {
  lifecycleStatus = 'archived';
  forceArchiveReason = `Hard archived: performance dropped to ${perf.toFixed(1)}%`;
}

if (lifecycleStatus === 'archived') {
  updateTrackedCallData(coin.contractAddress, {
    latestMarketCap: currentMc,
    athMc,
    lastUpdatedAt: new Date().toISOString(),
    lifecycleStatus: 'archived',
    isActive: false
  });

  console.log(
    `[Monitor] Archived ${coin.tokenName || coin.contractAddress} -> ${forceArchiveReason || 'Lifecycle archived'}`
  );

  continue;
}

      console.log(
        `[Monitor] ${coin.tokenName} → ${perf?.toFixed(1) ?? 'N/A'}% (${formatX(currentX)})`
      );

      const milestonesHit = Array.isArray(coin.milestonesHit) ? [...coin.milestonesHit] : [];
      const dumpHits = Array.isArray(coin.dumpAlertsHit) ? [...coin.dumpAlertsHit] : [];

      /**
       * MILESTONES
       */
      const newMilestones = getNewMilestones(perf, milestonesHit);

      for (const m of newMilestones) {
        queueMilestone(channel, coin, scan, m.key, perf);
        milestonesHit.push(m.key);
      }

      /**
       * APPROVAL QUEUE (LIVE)
       */
      const refreshedTrackedCall = getTrackedCall(coin.contractAddress) || coin;
      const approvalCheck = shouldCreateApprovalRequest(refreshedTrackedCall, currentX);

      if (approvalCheck.shouldSend) {
        queueApprovalReview(channel, refreshedTrackedCall, scan, approvalCheck.triggerX);
      }

      /**
       * X AUTO THREADING (APPROVED ONLY)
       */
      const latestTrackedCall = getTrackedCall(coin.contractAddress) || refreshedTrackedCall;
      await maybePublishApprovedMilestoneToX({
        ...latestTrackedCall,
        athMc,
        latestMarketCap: currentMc
      });

      /**
       * DUMPS (SMART)
       */
      const dump = getHighestDump(drawdown, dumpHits);

      if (dump) {
        queueDump(channel, coin, scan, dump.key, drawdown);

        dumpHits.push(dump.key);

        // if -55% hits first, auto-mark -35%
        if (dump.key === '-55%' && !dumpHits.includes('-35%')) {
          dumpHits.push('-35%');
        }
      }

      /**
       * SAVE STATE
       */
      updateTrackedCallData(coin.contractAddress, {
        latestMarketCap: currentMc,
        athMc,
        milestonesHit,
        dumpAlertsHit: dumpHits
      });

    } catch (err) {
      console.error(`[Monitor] Failed on ${coin.contractAddress}:`, err.message);
    }
  }
}

/**
 * =========================
 * START / STOP
 * =========================
 */

function startMonitoring(channel, intervalMs = 60000) {
  if (isRunning) return;

  isRunning = true;

  console.log(`[Monitor] Running every ${intervalMs / 1000}s`);

  checkTrackedCoins(channel);

  monitoringInterval = setInterval(() => {
    checkTrackedCoins(channel);
  }, intervalMs);
}

function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }

  isRunning = false;
}

module.exports = {
  startMonitoring,
  stopMonitoring,
  checkTrackedCoins
};