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
const { buildXPostText } = require('./buildXPostText');
const { AttachmentBuilder } = require('discord.js');
const {
  buildOhlcvCandlestickBuffer,
  buildOhlcvCandlestickBufferForTrackedCall,
  resolveOhlcvPairAddress
} = require('./ohlcvCandlestickBuffer');
const { getCandlestickOverlayProps } = require('./candlestickOverlayFromTracked');
const { persistChartMarkerEvents } = require('./chartEventPersistence');
const { buildOhlcvTimeframeRows } = require('./ohlcvChartControls');
const { resolvePublicCallerName } = require('./userProfileService');
const { resolveGuildForTrackedApproval } = require('./resolveGuildForTrackedApproval');
const {
  determineLifecycleStatus,
  getLifecycleChangeReason
} = require('./lifecycleEngine');

let monitoringIntervalUser = null;
let monitoringIntervalBot = null;
let isRunning = false;

/** When the main scanner is off, still push live MC / spot_multiple to Supabase for the dashboard. */
let performanceMirrorInterval = null;
let isPerformanceMirrorRunning = false;

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
  { key: '10x', x: 10, threshold: 900 },
  { key: '12x', x: 12, threshold: 1100 },
  { key: '15x', x: 15, threshold: 1400 },
  { key: '20x', x: 20, threshold: 1900 },
  { key: '25x', x: 25, threshold: 2400 },
  { key: '30x', x: 30, threshold: 2900 },
  { key: '35x', x: 35, threshold: 3400 },
  { key: '40x', x: 40, threshold: 3900 },
  { key: '50x', x: 50, threshold: 4900 },
  { key: '60x', x: 60, threshold: 5900 },
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

async function maybePublishApprovedMilestoneToX(trackedCall, latestScan = null) {
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

    const postText = await buildXPostText(trackedCall);

    let chartBuf = null;
    if (!hasOriginal) {
      chartBuf = await buildOhlcvCandlestickBufferForTrackedCall(
        trackedCall,
        latestScan
      );
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
function getNewMilestones(currentX, milestonesHit = []) {
  const x = Number(currentX);
  if (!Number.isFinite(x) || x <= 0) return [];

  return DISCORD_MILESTONE_LEVELS.filter(m =>
    x >= Number(m.x) && !milestonesHit.includes(m.key)
  );
}

function getMinSpacing(x) {
  const num = Number(x);
  if (!Number.isFinite(num)) return 10.0;
  if (num < 10) return 2.0;
  if (num < 20) return 4.0;
  if (num < 50) return 6.0;
  return 10.0;
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
      (ch.name === 'mod-approvals')
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
  const x = firstCalledMc > 0 ? ath / firstCalledMc : 0;

  const statusLabel =
    status === 'excluded' ? '🗑 EXCLUDED' :
    status === 'expired' ? '⌛ EXPIRED' :
    '⏳ PENDING REVIEW';

  const tags = Array.isArray(trackedCall.moderationTags) && trackedCall.moderationTags.length
    ? trackedCall.moderationTags.map(t => `\`${t}\``).join(' ')
    : 'None';

  const callerLabel = getPublicCallerLabel(trackedCall, 'Unknown');

  const embed = new EmbedBuilder()
    .setColor(
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

  const ca = trackedCall.contractAddress;
  if (ca) {
    const dexUrl = `https://dexscreener.com/solana/${ca}`;
    const gmgnUrl = `https://gmgn.ai/sol/token/${ca}`;
    embed.addFields({
      name: '📈 Charts',
      value: `[DexScreener](${dexUrl}) • [GMGN](${gmgnUrl})`,
      inline: false
    });
  }

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

async function pruneApprovalPool(client) {
  const active = getActivePendingApprovals();

  if (active.length <= MAX_ACTIVE_APPROVALS) return;

  const keep = active.slice(0, MAX_ACTIVE_APPROVALS);
  const remove = active.slice(MAX_ACTIVE_APPROVALS);

  const keepSet = new Set(keep.map(c => c.contractAddress));

  for (const trackedCall of remove) {
    if (keepSet.has(trackedCall.contractAddress)) continue;

    const pruneGuild = client ? await resolveGuildForTrackedApproval(client, trackedCall) : null;
    if (pruneGuild) {
      await deleteApprovalMessage(pruneGuild, trackedCall);
    } else {
      console.warn(
        '[ApprovalQueue] Could not resolve guild for pruned approval; skipping message delete:',
        trackedCall.contractAddress
      );
    }

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

    setApprovalMessageMeta(
      trackedCall.contractAddress,
      sent.id,
      approvalChannel.id,
      guild.id
    );

    console.log(
      `[ApprovalQueue] Queued ${trackedCall.tokenName || trackedCall.contractAddress} for ${triggerX}x approval`
    );

    await pruneApprovalPool(channel.client);

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
function buildReplyOptions(coin, channel) {
  if (!coin?.discordMessageId) return {};

  // Only reply when we can safely target the original message in THIS channel.
  // If we don't have a channel id, fall back to current behavior (reply in same channel).
  if (coin.discordChannelId && channel?.id && coin.discordChannelId !== channel.id) {
    return {};
  }

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

function queueMilestone(channel, coin, scan, key, perf, realXFromCall) {
  enqueueAlert(async () => {
    const replyOptions = buildReplyOptions(coin, channel);

    const pair = resolveOhlcvPairAddress(coin, scan);
    const overlay = getCandlestickOverlayProps(coin, scan);
    const chartBuf = await buildOhlcvCandlestickBuffer({
      pairAddress: pair,
      title: scan?.ticker || coin?.ticker || 'OHLC',
      ...overlay
    });

    const embed = createMilestoneEmbed(coin, scan, key, perf, realXFromCall);
    const payload = {
      embeds: [embed],
      ...replyOptions
    };

    if (chartBuf) {
      embed.setImage('attachment://chart.png');
      payload.files = [new AttachmentBuilder(chartBuf, { name: 'chart.png' })];
      payload.components = buildOhlcvTimeframeRows(coin.contractAddress, '5m');
    }

    await channel.send(payload);
  }, {
    type: 'milestone',
    contractAddress: coin.contractAddress,
    key
  });
}

function queueDump(channel, coin, scan, key, drawdown) {
  enqueueAlert(async () => {
    const replyOptions = buildReplyOptions(coin, channel);

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
 * Successful monitor tick requires a real scan object with finite marketCap > 0.
 * Null scan, missing/invalid marketCap, NaN, and mc <= 0 all count as failed scans.
 *
 * @param {unknown} scan
 * @returns {boolean}
 */
function isSuccessfulMarketScan(scan) {
  if (scan === null || scan === undefined) return false;
  if (typeof scan !== 'object') return false;
  const mc = Number(/** @type {{ marketCap?: unknown }} */ (scan).marketCap);
  return Number.isFinite(mc) && mc > 0;
}

/**
 * =========================
 * MAIN LOOP
 * =========================
 */

/**
 * @param {'user' | 'bot' | 'all'} [sourceBucket]
 */
async function checkTrackedCoins(channel, sourceBucket = 'all') {
  const tracked = getAllTrackedCalls();
  const activeCoins = tracked.filter(coin => {
    if (coin.lifecycleStatus === 'archived' || coin.isActive === false) {
      return false;
    }
    const src = String(coin.callSourceType || 'user_call');
    if (sourceBucket === 'user') {
      return src === 'user_call' || src === 'watch_only';
    }
    if (sourceBucket === 'bot') {
      return src === 'bot_call';
    }
    return true;
  });

  console.log(
    `[Monitor] Checking ${activeCoins.length} active ${sourceBucket} coins (${tracked.length} total tracked)`
  );

  for (const coin of activeCoins) {
    try {
      if (String(coin.approvalStatus || '').toLowerCase() === 'denied') {
        continue;
      }

      const scan = await generateRealScan(coin.contractAddress);

      if (!isSuccessfulMarketScan(scan)) {
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

      const currentMc = Number(/** @type {{ marketCap: number }} */ (scan).marketCap);
      const firstMc = coin.firstCalledMarketCap || currentMc;
      const athMc = Math.max(coin.athMc || firstMc, currentMc);

      const perf = calculatePerformancePercent(firstMc, currentMc);
const drawdown = calculateDrawdownPercent(athMc, currentMc);
const athX = calculateCurrentX(firstMc, athMc);
const initialMc = Number(firstMc) || 0;
const rawSpotX = initialMc > 0 ? currentMc / initialMc : 0;
const spotX = Number(rawSpotX.toFixed(2));

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

  try {
    const { queueUpdateUserCallPerformanceAth } = require('./callPerformanceSync');
    queueUpdateUserCallPerformanceAth(coin.contractAddress);
  } catch (_) {
    /* optional sync */
  }

  console.log(
    `[Monitor] Archived ${coin.tokenName || coin.contractAddress} -> ${forceArchiveReason || 'Lifecycle archived'}`
  );

  continue;
}

      console.log(
        `[Monitor] ${coin.tokenName} → ${perf?.toFixed(1) ?? 'N/A'}% (${formatX(athX)})`
      );

      // Hardening: use latest persisted milestone state to reduce accidental re-sends.
      const persisted = getTrackedCall(coin.contractAddress);
      const milestonesHit = Array.isArray(persisted?.milestonesHit)
        ? [...persisted.milestonesHit]
        : (Array.isArray(coin.milestonesHit) ? [...coin.milestonesHit] : []);
      const dumpHits = Array.isArray(coin.dumpAlertsHit) ? [...coin.dumpAlertsHit] : [];
      let lastPostedXOut = Number(persisted?.lastPostedX || 0);

      /**
       * MILESTONES
       */
      const newMilestones = getNewMilestones(spotX, milestonesHit);

      for (const m of newMilestones) {
        if (!milestonesHit.includes(m.key)) {
          milestonesHit.push(m.key);
        }
      }

      if (milestonesHit.length > 0) {
        const lastX = lastPostedXOut;
        const spacing = getMinSpacing(spotX);
        const delta = spotX - lastX;

        if (delta >= spacing) {
          const topMilestone =
            newMilestones.length > 0
              ? newMilestones[newMilestones.length - 1]
              : DISCORD_MILESTONE_LEVELS.filter(
                  m => milestonesHit.includes(m.key) && spotX >= Number(m.x)
                ).slice(-1)[0];
          if (topMilestone) {
            queueMilestone(channel, coin, scan, topMilestone.key, perf, spotX);
            lastPostedXOut = spotX;
          }
        }
      }

      /**
       * APPROVAL QUEUE (LIVE)
       */
      const refreshedTrackedCall = getTrackedCall(coin.contractAddress) || coin;
      const approvalCheck = shouldCreateApprovalRequest(refreshedTrackedCall, athX);

      if (approvalCheck.shouldSend) {
        queueApprovalReview(channel, refreshedTrackedCall, scan, approvalCheck.triggerX);
      }

      /**
       * X AUTO THREADING (APPROVED ONLY)
       */
      const latestTrackedCall = getTrackedCall(coin.contractAddress) || refreshedTrackedCall;
      await maybePublishApprovedMilestoneToX(
        {
          ...latestTrackedCall,
          athMc,
          latestMarketCap: currentMc
        },
        scan
      );

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

      try {
        await persistChartMarkerEvents(coin.contractAddress, scan);
      } catch (markerErr) {
        console.error(
          '[Monitor] chart markers',
          coin.contractAddress,
          markerErr?.message || markerErr
        );
      }

      /**
       * SAVE STATE
       */
      const MAX_CHART_HISTORY = 500;
      let priceHistory = Array.isArray(persisted?.priceHistory)
        ? [...persisted.priceHistory]
        : [];
      priceHistory.push({ t: Date.now(), price: Number(currentMc) });
      if (priceHistory.length > MAX_CHART_HISTORY) {
        priceHistory = priceHistory.slice(-MAX_CHART_HISTORY);
      }

      updateTrackedCallData(coin.contractAddress, {
        latestMarketCap: currentMc,
        athMc,
        milestonesHit,
        dumpAlertsHit: dumpHits,
        lastPostedX: lastPostedXOut,
        priceHistory
      });

      try {
        const { queueUpdateUserCallPerformanceAth } = require('./callPerformanceSync');
        queueUpdateUserCallPerformanceAth(coin.contractAddress);
      } catch (_) {
        /* optional sync */
      }

    } catch (err) {
      console.error('[Monitor ERROR]');
      console.error('Contract:', coin.contractAddress);
      console.error('Stack:', err.stack);
    }
  }
}

/**
 * =========================
 * START / STOP
 * =========================
 */

/**
 * @param {import('discord.js').TextChannel} channel
 * @param {number | { userIntervalMs?: number; botIntervalMs?: number }} [intervalOrOpts]
 *        Legacy: single number = both buckets use same interval (old behavior).
 */
function startMonitoring(channel, intervalOrOpts = {}) {
  if (isRunning) return;

  stopUserPerformanceSupabaseMirror();

  isRunning = true;

  let userMs = 30000;
  let botMs = 60000;

  if (typeof intervalOrOpts === 'number' && Number.isFinite(intervalOrOpts) && intervalOrOpts > 0) {
    userMs = intervalOrOpts;
    botMs = intervalOrOpts;
  } else if (intervalOrOpts && typeof intervalOrOpts === 'object') {
    const u = Number(intervalOrOpts.userIntervalMs);
    const b = Number(intervalOrOpts.botIntervalMs);
    if (Number.isFinite(u) && u >= 5000) userMs = u;
    if (Number.isFinite(b) && b >= 5000) botMs = b;
  }

  console.log(
    `[Monitor] User/watch bucket every ${userMs / 1000}s, bot bucket every ${botMs / 1000}s`
  );

  void checkTrackedCoins(channel, 'user');
  void checkTrackedCoins(channel, 'bot');

  monitoringIntervalUser = setInterval(() => {
    void checkTrackedCoins(channel, 'user');
  }, userMs);

  monitoringIntervalBot = setInterval(() => {
    void checkTrackedCoins(channel, 'bot');
  }, botMs);
}

function stopMonitoring() {
  if (monitoringIntervalUser) {
    clearInterval(monitoringIntervalUser);
    monitoringIntervalUser = null;
  }
  if (monitoringIntervalBot) {
    clearInterval(monitoringIntervalBot);
    monitoringIntervalBot = null;
  }

  isRunning = false;
  stopUserPerformanceSupabaseMirror();
}

/**
 * Lightweight loop: refresh MC for active **user_call** rows that have a `call_performance` id,
 * then mirror to Supabase. No Discord milestones / dumps.
 * Use when `SCANNER_ENABLED` is false so dashboard live X still updates.
 *
 * @param {{ intervalMs?: number }} [opts]
 */
function startUserPerformanceSupabaseMirror(opts = {}) {
  if (isPerformanceMirrorRunning) return;
  const ms = Number(opts.intervalMs);
  const intervalMs = Number.isFinite(ms) && ms >= 10_000 ? ms : 30_000;

  isPerformanceMirrorRunning = true;
  console.log(
    `[PerformanceMirror] Starting Supabase stats mirror every ${intervalMs / 1000}s (scanner alerts may be off)`
  );

  const tick = async () => {
    const tracked = getAllTrackedCalls();
    const coins = tracked.filter(coin => {
      if (!coin) return false;
      if (coin.lifecycleStatus === 'archived' || coin.isActive === false) return false;
      if (String(coin.callSourceType || 'user_call') !== 'user_call') return false;
      if (String(coin.approvalStatus || '').toLowerCase() === 'denied') return false;
      if (!String(coin.callPerformanceId || '').trim()) return false;
      return true;
    });

    if (coins.length === 0) return;

    let ok = 0;
    for (const coin of coins) {
      try {
        const scan = await generateRealScan(coin.contractAddress);
        if (!isSuccessfulMarketScan(scan)) continue;

        const currentMc = Number(scan.marketCap);
        const firstMc = coin.firstCalledMarketCap || currentMc;
        const athMc = Math.max(coin.athMc || firstMc, currentMc);

        const persisted = getTrackedCall(coin.contractAddress) || coin;
        let priceHistory = Array.isArray(persisted?.priceHistory) ? [...persisted.priceHistory] : [];
        priceHistory.push({ t: Date.now(), price: currentMc });
        if (priceHistory.length > 500) {
          priceHistory = priceHistory.slice(-500);
        }

        updateTrackedCallData(coin.contractAddress, {
          latestMarketCap: currentMc,
          athMc,
          failedScans: 0,
          lastUpdatedAt: new Date().toISOString(),
          priceHistory
        });

        const { queueUpdateUserCallPerformanceAth } = require('./callPerformanceSync');
        queueUpdateUserCallPerformanceAth(coin.contractAddress);
        ok += 1;
      } catch (err) {
        console.error(
          '[PerformanceMirror]',
          coin.contractAddress,
          err && err.message ? err.message : err
        );
      }
    }

    if (ok > 0) {
      console.log(`[PerformanceMirror] Updated ${ok}/${coins.length} user call(s) → Supabase`);
    }
  };

  void tick();
  performanceMirrorInterval = setInterval(() => {
    void tick();
  }, intervalMs);
}

function stopUserPerformanceSupabaseMirror() {
  if (performanceMirrorInterval) {
    clearInterval(performanceMirrorInterval);
    performanceMirrorInterval = null;
  }
  isPerformanceMirrorRunning = false;
}

module.exports = {
  startMonitoring,
  stopMonitoring,
  checkTrackedCoins,
  startUserPerformanceSupabaseMirror,
  stopUserPerformanceSupabaseMirror
};