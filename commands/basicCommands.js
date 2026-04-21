const {
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require('discord.js');

const { generateFakeScan, generateBatchScans } = require('../utils/scannerEngine');
const { fetchRealTokenData } = require('../providers/realTokenProvider');
const {
  getTrackedCall,
  saveTrackedCall,
  reactivateTrackedCall,
  loadTrackedCalls,
  updateTrackedCallData
} = require('../utils/trackedCallsService');
const { resolvePublicCallerName } = require('../utils/userProfileService');
const {
  getCallerStats,
  getCallerLeaderboard,
  getBotStats
} = require('../utils/callerStatsService');
const { renderPriceChart, seriesFromTrackedPriceHistory } = require('../utils/renderChart');
const { formatAgeMinutes } = require('../utils/formatAgeMinutes');
const { applyScanThumbnailToEmbed } = require('../utils/embedTokenThumbnail');
const { buildOhlcvCandlestickBuffer } = require('../utils/ohlcvCandlestickBuffer');
const { getCandlestickOverlayProps } = require('../utils/candlestickOverlayFromTracked');
const { buildOhlcvTimeframeRows } = require('../utils/ohlcvChartControls');

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

function formatUsd(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatCompactUsd(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'N/A';

  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
  return `${Number(value).toFixed(1)}%`;
}

function formatValue(value, fallback = 'Unknown') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function yesNo(value) {
  return value ? 'Yes' : 'No';
}

function formatReasonList(reasons) {
  if (!reasons || reasons.length === 0) return 'None';
  return reasons.map(reason => `• ${reason}`).join('\n');
}

function formatProfileName(profile) {
  if (!profile) return 'Balanced';
  return profile.charAt(0).toUpperCase() + profile.slice(1);
}

function getHoursSince(timestamp) {
  if (!timestamp) return null;

  const then = new Date(timestamp).getTime();
  const now = Date.now();

  if (!then || Number.isNaN(then)) return null;

  return (now - then) / (1000 * 60 * 60);
}

function safeLink(label, url) {
  return url ? `[${label}](${url})` : null;
}

function isLikelySolanaCA(input = '') {
  const clean = String(input || '').trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean);
}

function shortenCA(ca) {
  if (!ca || ca.length < 14) return ca || 'Unknown';
  return `${ca.slice(0, 6)}...${ca.slice(-6)}`;
}

function buildActionButtons(contractAddress) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`call_coin:${contractAddress}`)
        .setLabel('📍 Call')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`watch_coin:${contractAddress}`)
        .setLabel('👀 Watch')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

function buildDisabledActionButtons(contractAddress, actionLabel = 'Done') {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`call_coin:${contractAddress}`)
        .setLabel(actionLabel)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`watch_coin:${contractAddress}`)
        .setLabel('Processed')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    )
  ];
}

function isMeaningfulText(value) {
  if (value === null || value === undefined) return false;
  const str = String(value).trim();
  if (!str) return false;

  const lowered = str.toLowerCase();
  return !['unknown', 'n/a', 'none', 'null', 'undefined'].includes(lowered);
}

function isMeaningfulNumber(value, { allowZero = false } = {}) {
  if (value === null || value === undefined || value === '') return false;
  const num = Number(value);
  if (Number.isNaN(num)) return false;
  if (!allowZero && num === 0) return false;
  return true;
}

function buildLinksLine(links) {
  const parts = links.filter(link => isMeaningfulText(link));
  return parts.length ? parts.join(' • ') : null;
}

function addLineIfMeaningful(lines, label, rawValue, formatter = (v) => v, options = {}) {
  const { allowZero = false, type = 'text' } = options;

  const valid =
    type === 'number'
      ? isMeaningfulNumber(rawValue, { allowZero })
      : isMeaningfulText(rawValue);

  if (!valid) return;

  const formatted = formatter(rawValue);
  if (!isMeaningfulText(formatted) && !(type === 'number' && isMeaningfulNumber(rawValue, { allowZero }))) {
    return;
  }

  lines.push(`**${label}:** ${formatted}`);
}

function addFieldIfHasContent(fields, name, lines, inline = true) {
  if (!lines || lines.length === 0) return;
  fields.push({
    name,
    value: lines.join('\n'),
    inline
  });
}

function getDisplayMomentum(scan) {
  const vol5 = Number(scan.volume5m || 0);
  const ratio = Number(scan.buySellRatio5m || 0);
  const trend = scan.volumeTrend || 'Unknown';
  const price5m = Number(scan.priceChange5m || 0);

  let score = 0;

  if (vol5 >= 15000) score += 3;
  else if (vol5 >= 7000) score += 2;
  else if (vol5 >= 3000) score += 1;

  if (ratio >= 1.8) score += 3;
  else if (ratio >= 1.2) score += 2;
  else if (ratio >= 1.0) score += 1;
  else if (ratio > 0 && ratio < 0.8) score -= 2;

  if (trend === 'Very Strong') score += 2;
  else if (trend === 'Strong') score += 1;
  else if (trend === 'Weak') score -= 1;

  if (price5m >= 12) score += 2;
  else if (price5m >= 5) score += 1;
  else if (price5m <= -10) score -= 2;

  if (score >= 7) return 'Very Strong';
  if (score >= 4) return 'Strong';
  if (score >= 2) return 'Moderate';
  if (score <= -1) return 'Weak';
  return 'Neutral';
}

function getTradeQualityLabel(scan) {
  const ratio = Number(scan.buySellRatio5m || 0);
  const vol5 = Number(scan.volume5m || 0);

  if (ratio >= 1.8 && vol5 >= 10000) return 'High';
  if (ratio >= 1.2 && vol5 >= 5000) return 'Good';
  if (vol5 < 2000) return 'Low';
  return 'Moderate';
}

function calculateQuickRealScore(realData) {
  let score = 50;

  const mc = realData.market?.marketCap || 0;
  const liq = realData.market?.liquidity || 0;
  const vol = realData.market?.volume5m || 0;
  const age = realData.market?.ageMinutes || 0;

  const hasWebsite = !!realData.token?.website;
  const hasTwitter = !!realData.token?.twitter;
  const hasTelegram = !!realData.token?.telegram;
  const dexPaid = !!realData.socials?.dexPaid;
  const migrated = !!realData.meta?.migrated;

  const buySellRatio5m = Number(realData.tradeSignals?.buySellRatio5m || 0);
  const volumeTrend = realData.tradeSignals?.volumeTrend || 'Unknown';
  const tradePressure = realData.tradeSignals?.tradePressure || 'Unknown';

  if (liq > 50000) score += 15;
  else if (liq > 20000) score += 10;
  else if (liq < 5000) score -= 10;

  if (vol > 20000) score += 15;
  else if (vol > 10000) score += 10;
  else if (vol < 2000) score -= 10;

  if (age > 0 && age < 30) score += 10;
  else if (age > 300) score -= 10;

  if (mc > 50000 && mc < 500000) score += 10;
  if (mc < 10000) score -= 10;

  if (buySellRatio5m >= 1.8) score += 12;
  else if (buySellRatio5m >= 1.25) score += 8;
  else if (buySellRatio5m > 0 && buySellRatio5m < 0.8) score -= 10;

  if (tradePressure === 'Very Bullish') score += 8;
  else if (tradePressure === 'Bullish') score += 5;
  else if (tradePressure === 'Bearish' || tradePressure === 'Very Bearish') score -= 8;

  if (volumeTrend === 'Very Strong') score += 8;
  else if (volumeTrend === 'Strong') score += 5;
  else if (volumeTrend === 'Weak') score -= 5;

  if (hasWebsite) score += 5;
  if (hasTwitter) score += 5;
  if (hasTelegram) score += 5;
  if (dexPaid) score += 5;

  if (migrated) score += 3;

  return Math.max(0, Math.min(100, score));
}

function getQuickGrade(score) {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function getQuickAlertType(score) {
  if (score >= 80) return '🔥 Strong Setup';
  if (score >= 65) return '⚡ Moderate Setup';
  if (score >= 50) return '📡 Watchlist';
  return '⚠️ Risky';
}

function getRiskLabel(data) {
  const liq = Number(data.market?.liquidity || 0);
  const buySellRatio = Number(data.tradeSignals?.buySellRatio5m || 0);
  const age = Number(data.market?.ageMinutes || 0);

  let risk = 0;

  if (liq < 5000) risk += 2;
  else if (liq < 10000) risk += 1;

  if (buySellRatio > 0 && buySellRatio < 0.8) risk += 2;
  else if (buySellRatio > 0 && buySellRatio < 1.0) risk += 1;

  if (age > 180) risk += 1;

  if (risk >= 4) return 'High';
  if (risk >= 2) return 'Moderate';
  return 'Low';
}

function buildScanFlags(data) {
  const greenFlags = [];
  const redFlags = [];

  const liq = Number(data.market?.liquidity || 0);
  const vol5m = Number(data.market?.volume5m || 0);
  const vol1h = Number(data.market?.volume1h || 0);
  const tradePressure = data.tradeSignals?.tradePressure || '';
  const dexPaid = !!data.socials?.dexPaid;

  if (liq >= 20000) greenFlags.push('Strong liquidity');
  else if (liq < 5000) redFlags.push('Weak liquidity');

  if (vol5m >= 5000) greenFlags.push('Strong 5m volume');
  if (vol1h >= 15000) greenFlags.push('1h volume building');

  if (tradePressure === 'Bullish' || tradePressure === 'Very Bullish') {
    greenFlags.push('Buy pressure strong');
  } else if (tradePressure === 'Bearish') {
    redFlags.push('Sell pressure showing');
  }

  if (!dexPaid) {
    redFlags.push('Not Dex Paid');
  }

  return { greenFlags, redFlags };
}

function normalizeRealDataToScan(realData) {
  const score = calculateQuickRealScore(realData);
  const dexTokenImageUrl =
    realData.token?.imageUrl || realData.token?.logoURI || null;
  const geckoTokenImageUrl = realData.token?.geckoImageUrl || null;
  const flatImageUrl =
    (dexTokenImageUrl && String(dexTokenImageUrl).trim()) ||
    (geckoTokenImageUrl && String(geckoTokenImageUrl).trim()) ||
    null;

  const tokenBlock = {};
  if (dexTokenImageUrl && String(dexTokenImageUrl).trim()) {
    tokenBlock.imageUrl = String(dexTokenImageUrl).trim();
  }
  if (geckoTokenImageUrl && String(geckoTokenImageUrl).trim()) {
    tokenBlock.geckoImageUrl = String(geckoTokenImageUrl).trim();
  }

  return {
    tokenImageUrl: flatImageUrl,
    tokenName: realData.token?.tokenName || 'Unknown Token',
    ticker: realData.token?.ticker || 'UNKNOWN',
    contractAddress: realData.token?.contractAddress || 'Unknown',
    pairAddress: realData.token?.pairAddress || null,
    website: realData.token?.website || null,
    twitter: realData.token?.twitter || null,
    telegram: realData.token?.telegram || null,

    marketCap: Number(realData.market?.marketCap || 0),
    liquidity: Number(realData.market?.liquidity || 0),
    volume5m: Number(realData.market?.volume5m || 0),
    volume1h: Number(realData.market?.volume1h || 0),
    ageMinutes: Number(realData.market?.ageMinutes || 0),
    ath: Number(realData.market?.ath || 0),
    percentFromAth: Number(realData.market?.percentFromAth || 0),

    holders: realData.holders?.holders ?? null,
    top10HolderPercent: realData.holders?.top10HolderPercent ?? null,
    devHoldingPercent: realData.holders?.devHoldingPercent ?? null,
    bundleHoldingPercent: realData.holders?.bundleHoldingPercent ?? null,
    sniperPercent: realData.holders?.sniperPercent ?? null,

    buySellRatio5m: Number(realData.tradeSignals?.buySellRatio5m || 0),
    buySellRatio1h: Number(realData.tradeSignals?.buySellRatio1h || 0),
    tradePressure: realData.tradeSignals?.tradePressure || 'Unknown',
    volumeTrend: realData.tradeSignals?.volumeTrend || 'Unknown',

    dexPaid: !!realData.socials?.dexPaid,
    migrated: !!realData.meta?.migrated,

    ...(Number.isFinite(Number(realData.market?.price)) &&
    Number(realData.market?.price) > 0
      ? { priceUsd: Number(realData.market.price) }
      : {}),

    entryScore: score,
    grade: getQuickGrade(score),
    alertType: getQuickAlertType(score),
    status: score >= 70 ? 'Strong' : score >= 55 ? 'Watch' : 'Risky',
    conviction: score >= 80 ? 'High' : score >= 60 ? 'Moderate' : 'Low',
    riskLevel: getRiskLabel(realData),

    ...(Object.keys(tokenBlock).length ? { token: tokenBlock } : {})
  };
}

async function refreshTrackedCallLive(contractAddress) {
  try {
    const realData = await fetchRealTokenData(contractAddress);
    const score = calculateQuickRealScore(realData);

    const img =
      realData.token?.imageUrl ||
      realData.token?.logoURI ||
      realData.token?.geckoImageUrl ||
      null;

    updateTrackedCallData(contractAddress, {
      tokenName: realData.token?.tokenName || 'Unknown Token',
      ticker: realData.token?.ticker || 'UNKNOWN',
      ...(img && String(img).trim()
        ? { tokenImageUrl: String(img).trim().slice(0, 800) }
        : {}),
      latestMarketCap: realData.market?.marketCap || 0,
      entryScore: score,
      grade: getQuickGrade(score),
      alertType: getQuickAlertType(score),
      ath: realData.market?.ath || 0,
      percentFromAth: realData.market?.percentFromAth || 0,
      migrated: realData.meta?.migrated || false,
      holders: realData.holders?.holders ?? null,
      top10HolderPercent: realData.holders?.top10HolderPercent ?? null,
      devHoldingPercent: realData.holders?.devHoldingPercent ?? null,
      bundleHoldingPercent: realData.holders?.bundleHoldingPercent ?? null,
      sniperPercent: realData.holders?.sniperPercent ?? null
    });

    return getTrackedCall(contractAddress);
  } catch (error) {
    console.log(`[Tracked Refresh] Real refresh failed for ${contractAddress}: ${error.message}`);
    return getTrackedCall(contractAddress);
  }
}

function createCommandsEmbed(message) {
  const canSeeModHelp = memberCanManageGuild(message.member) || isBotOwner(message.author);
  const canSeeOwnerHelp = isBotOwner(message.author);

  const fields = [
    {
      name: '🔍 Scan & call',
      value:
        '`!ping` / `!status` — bot checks\n' +
        '`!ca [CA]` — compact intel (no tracking)\n' +
        '`!scan` — random simulated scan\n' +
        '`!scan [CA]` — simulated deep scan (no tracking)\n' +
        '`!call [CA]` — call + track\n' +
        '`!watch [CA]` — track, no caller credit\n' +
        '`!testreal [CA]` — live provider test (embed)\n' +
        '`!autoscantest` [profile] — simulated auto alerts',
      inline: false
    },
    {
      name: '📚 Tracking & stats',
      value:
        '`!tracked` / `!tracked [CA]` — summary or detail\n' +
        '`!caller [name]` or `!caller @user` — caller stats\n' +
        '`!callerboard` / `!botstats` — leaderboards & McGBot stats\n' +
        '`!profile` / `!myprofile` — profile + **Connect X** (or **#verify-x** / dashboard)\n' +
        '`!credit` anonymous|discord|xtag — public credit label',
      inline: false
    },
    {
      name: '📌 More (see `!help`)',
      value:
        'Highlights: `!bestcall24h` … `!addlaunch` … `!devleaderboard`\n' +
        '**Full list:** `!help` / `!commands` (plain text, chunked if long; sections match your permissions)',
      inline: false
    }
  ];

  if (canSeeModHelp) {
    fields.push({
      name: '🛡️ Manage Server (summary)',
      value:
        '`!scanner` / `!scanner on|off`, approvals, `!pendingapprovals`, `!resetmonitor`, … — see `!help`',
      inline: false
    });
  }

  if (canSeeOwnerHelp) {
    fields.push({
      name: '⚙️ Bot owner (summary)',
      value: 'Scanner thresholds & sanity filters — see `!help` / `!commands`',
      inline: false
    });
  }

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📘 Crypto Scanner Bot — Command cheat sheet')
    .setDescription(
      'Short reference. **Authoritative list:** `!help` / `!commands` in Discord (plain text; mod/owner sections only if you have access).'
    )
    .addFields(fields)
    .setFooter({ text: 'Crypto Scanner Bot • Use !help for the authoritative list' })
    .setTimestamp();
}

function createRealTestEmbed(data) {
  const fields = [];

  fields.push({
    name: '🧾 Contract Address',
    value: `\`${formatValue(data.token.contractAddress, 'N/A')}\``,
    inline: false
  });

  const marketLines = [];
  addLineIfMeaningful(marketLines, 'Market Cap', data.market.marketCap, formatUsd, { type: 'number' });
  addLineIfMeaningful(marketLines, 'Liquidity', data.market.liquidity, formatUsd, { type: 'number' });
  addLineIfMeaningful(marketLines, 'Volume (5m)', data.market.volume5m, formatUsd, { type: 'number' });
  addLineIfMeaningful(marketLines, 'Volume (1h)', data.market.volume1h, formatUsd, { type: 'number' });
  addLineIfMeaningful(marketLines, 'Age', data.market.ageMinutes, (v) => `${v} min`, { type: 'number', allowZero: true });

  addFieldIfHasContent(fields, '📊 Market', marketLines, true);

  const tradeLines = [];
  addLineIfMeaningful(tradeLines, 'Buy/Sell (5m)', data.tradeSignals?.buySellRatio5m, (v) => String(v));
  addLineIfMeaningful(tradeLines, 'Buy/Sell (1h)', data.tradeSignals?.buySellRatio1h, (v) => String(v));
  addLineIfMeaningful(tradeLines, 'Trade Pressure', data.tradeSignals?.tradePressure);
  addLineIfMeaningful(tradeLines, 'Volume Trend', data.tradeSignals?.volumeTrend);

  addFieldIfHasContent(fields, '📈 Trade Signals', tradeLines, true);

  const links = buildLinksLine([
    data.token?.website ? `[Website](${data.token.website})` : null,
    data.token?.twitter ? `[X / Twitter](${data.token.twitter})` : null,
    data.token?.telegram ? `[Telegram](${data.token.telegram})` : null
  ]);

  if (links) {
    fields.push({
      name: '🔗 Links',
      value: links,
      inline: false
    });
  }

  return new EmbedBuilder()
    .setColor(0x3399ff)
    .setTitle(`🧪 Real Provider Test • ${formatValue(data.token.tokenName, 'Unknown')} (${formatValue(data.token.ticker, 'N/A')})`)
    .setDescription('Testing live provider fetch')
    .addFields(fields)
    .setFooter({ text: 'Live Provider Debug Test' })
    .setTimestamp();
}

function createTrackedSummaryEmbed(calls) {
  const total = calls.length;
  const active = calls.filter(call => call.lifecycleStatus === 'active').length;
  const stagnant = calls.filter(call => call.lifecycleStatus === 'stagnant').length;
  const archived = calls.filter(call => call.lifecycleStatus === 'archived').length;

  const recentCalls = calls
    .slice(-5)
    .reverse()
    .map(call => {
      const sourceLabel =
        call.callSourceType === 'watch_only'
          ? 'watch'
          : call.callSourceType === 'bot_call'
            ? 'bot'
            : 'call';

      return `• **${call.tokenName} (${call.ticker})** — ${call.lifecycleStatus} • ${sourceLabel}`;
    })
    .join('\n') || 'No tracked calls yet.';

  return new EmbedBuilder()
    .setColor(0x9966ff)
    .setTitle('📚 Tracked Calls Overview')
    .setDescription(
      `**Total Tracked:** ${total}\n` +
      `🟢 **Active:** ${active}\n` +
      `🟡 **Stagnant:** ${stagnant}\n` +
      `⚫ **Archived:** ${archived}`
    )
    .addFields({
      name: '🕒 Most Recent Tracked Coins',
      value: recentCalls,
      inline: false
    })
    .setFooter({ text: 'Crypto Scanner Bot • Tracking Overview' })
    .setTimestamp();
}

function createTrackedDetailEmbed(call) {
  const sourceLabel =
    call.callSourceType === 'watch_only'
      ? '👀 Watch Only'
      : call.callSourceType === 'bot_call'
        ? '🤖 Bot Call'
        : '📍 User Call';

  const callerDisplay =
    call.callSourceType === 'watch_only'
      ? 'No caller credit'
      : call.callSourceType === 'bot_call'
        ? 'Auto Bot'
        : resolvePublicCallerName({
            discordUserId: call.firstCallerDiscordId || null,
            username: call.firstCallerUsername || '',
            displayName: call.firstCallerDisplayName || '',
            trackedCall: call,
            fallback: call.firstCallerUsername || 'Unknown'
          });

  const fields = [
    {
      name: '🧾 Contract Address',
      value: `\`${formatValue(call.contractAddress, 'N/A')}\``,
      inline: false
    },
    { name: '🏷 Source Type', value: sourceLabel, inline: true },
    { name: '👤 First Caller', value: callerDisplay, inline: true },
    { name: '💰 First Called MC', value: formatUsd(call.firstCalledMarketCap), inline: true },
    { name: '📈 Latest MC', value: formatUsd(call.latestMarketCap), inline: true },
    { name: '🎯 Entry Score', value: `${formatValue(call.entryScore, 'N/A')}/100`, inline: true },
    { name: '🏅 Grade', value: formatValue(call.grade, 'N/A'), inline: true },
    { name: '📡 Alert Type', value: formatValue(call.alertType, 'N/A'), inline: true },
    {
      name: '🚀 Milestones Hit',
      value: call.milestonesHit?.length ? call.milestonesHit.join(', ') : 'None',
      inline: false
    },
    {
      name: '💀 Dip Alerts Hit',
      value: call.dumpAlertsHit?.length ? call.dumpAlertsHit.join(', ') : 'None',
      inline: false
    },
    {
      name: '⏱ Tracking Times',
      value:
        `**First Called:** ${formatValue(call.firstCalledAt, 'N/A')}\n` +
        `**Last Updated:** ${formatValue(call.lastUpdatedAt, 'N/A')}`,
      inline: false
    }
  ];

  return new EmbedBuilder()
    .setColor(0xffcc66)
    .setTitle(`📍 Tracked Coin • ${call.tokenName} (${call.ticker})`)
    .setDescription(
      `**Lifecycle:** ${formatValue(call.lifecycleStatus, 'active')}\n` +
      `**Active Monitor:** ${yesNo(call.isActive !== false)}`
    )
    .addFields(fields)
    .setFooter({ text: 'Crypto Scanner Bot • Tracked Coin Details' })
    .setTimestamp();
}

function getPublicCaller(scan) {
  if (!scan) return 'Unknown';

  if (scan.callSourceType === 'bot_call') {
    return 'Auto Bot';
  }

  if (scan.callSourceType === 'watch_only') {
    return 'No caller credit';
  }

  return resolvePublicCallerName({
    discordUserId: scan.firstCallerDiscordId || null,
    username: scan.firstCallerUsername || '',
    displayName: scan.firstCallerDisplayName || '',
    trackedCall: scan,
    fallback: scan.firstCallerUsername || 'Unknown'
  });
}

function createCallStatusLine(scan) {
  const isWatchOnly = scan.callSourceType === 'watch_only';
  const callerName = getPublicCaller(scan);

  let statusLine = '';

  if (isWatchOnly) {
    if (scan.isReactivated) {
      statusLine = `♻️ **WATCH REACTIVATED**`;
    } else if (scan.isNewCall) {
      statusLine = `👀 **WATCHLIST ADDED**`;
    } else if (scan.lifecycleStatus === 'stagnant') {
      statusLine = `⏸️ **STAGNANT WATCHLIST COIN**`;
    } else {
      statusLine = `👀 **ALREADY WATCHING**`;
    }
  } else {
    if (scan.isReactivated) {
      statusLine = `♻️ **REACTIVATED**`;
    } else if (scan.isNewCall) {
      statusLine = `🆕 **FIRST CALLED**`;
    } else if (scan.lifecycleStatus === 'stagnant') {
      statusLine = `⏸️ **STAGNANT TRACKED COIN**`;
    } else {
      statusLine = `🧠 **ALREADY TRACKED**`;
    }
  }

  const sourceLine =
    scan.callSourceType === 'watch_only'
      ? `👀 **Watch Only • No caller credit**`
      : scan.callSourceType === 'bot_call'
        ? `🤖 **Bot Tracked Coin**`
        : `📍 **Called by ${callerName} @ ${formatUsd(scan.firstCalledMarketCap)}**`;

  return `${statusLine}\n${sourceLine}\n\n`;
}

function formatMilestoneLine(milestoneHit, isNewCall, isNewMilestone) {
  if (isNewCall || !milestoneHit) return '';
  return `${isNewMilestone ? '🏆' : '🎯'} **Milestone:** ${milestoneHit}\n`;
}

function formatPerformanceLine(performancePercent, isNewCall) {
  if (isNewCall || performancePercent === null || performancePercent === undefined) return '';
  return `📉 **Since first track:** ${formatPercent(performancePercent)}\n\n`;
}

function createCompactCaEmbed(data) {
  const tokenName = formatValue(data.token?.tokenName, 'Unknown Token');
  const ticker = formatValue(data.token?.ticker, 'N/A');
  const contractAddress = formatValue(data.token?.contractAddress, 'Unknown');
  const marketCap = data.market?.marketCap || 0;
  const ath = data.market?.ath || data.market?.marketCap || 0;

  return new EmbedBuilder()
    .setColor(0x00cc99)
    .setTitle(`⚡ ${tokenName} (${ticker})`)
    .setDescription(
      `**CA:** \`${shortenCA(contractAddress)}\`\n` +
      `**MC:** ${formatCompactUsd(marketCap)}\n` +
      `**ATH:** ${formatCompactUsd(ath)}`
    )
    .setFooter({ text: 'Crypto Scanner Bot • Compact CA Intel' })
    .setTimestamp();
}

function createTraderScanEmbed(scan, options = {}) {
  const showTrackedMeta = options.showTrackedMeta === true;

  const callStatusLine = showTrackedMeta && scan.callSourceType ? createCallStatusLine(scan) : '';
  const milestoneLine = showTrackedMeta ? formatMilestoneLine(scan.milestoneHit, scan.isNewCall, scan.isNewMilestone) : '';
  const performanceLine = showTrackedMeta ? formatPerformanceLine(scan.performancePercent, scan.isNewCall) : '';

  const tokenNameUpper = formatValue(scan.tokenName, 'UNKNOWN TOKEN').toUpperCase();
  const tickerUpper = formatValue(scan.ticker, 'UNKNOWN').toUpperCase();

  const metaBlock = [callStatusLine, milestoneLine, performanceLine].filter(Boolean).join('');

  const signalLines = [
    `**${formatValue(scan.alertType, 'Scan')}**`,
    `• Momentum: ${getDisplayMomentum(scan)} · Risk: ${formatValue(scan.riskLevel)} · Pressure: ${formatValue(
      scan.tradePressure,
      'Unknown'
    )}`
  ];
  if (options.chartPending) {
    signalLines.push('📊 Chart: Loading…');
  }

  const snapshotLines = [
    `• Liq: ${formatUsd(scan.liquidity)}`,
    `• 5m vol: ${formatUsd(scan.volume5m)} · 1h vol: ${formatUsd(scan.volume1h)}`,
    `• Age: ${formatAgeMinutes(scan.ageMinutes)}`
  ];
  if (isMeaningfulNumber(scan.holders, { allowZero: false })) {
    snapshotLines.push(`• Holders: ${scan.holders}`);
  }

  const tradeLines = [
    `• 5m B/S: ${formatValue(scan.buySellRatio5m, 'N/A')} · 1h B/S: ${formatValue(scan.buySellRatio1h, 'N/A')}`,
    `• Quality: ${getTradeQualityLabel(scan)}`
  ];

  const verdictLines = [
    `• Score: ${formatValue(scan.entryScore, 'N/A')}/100 · Grade: ${formatValue(scan.grade, 'N/A')}`,
    `• Status: ${formatValue(scan.status, 'N/A')} · Conviction: ${formatValue(scan.conviction, 'N/A')}`
  ];

  const sections = [];

  sections.push(`💰 ${formatUsd(scan.marketCap)} MC`);
  if (metaBlock.trim()) {
    sections.push(metaBlock.trimEnd());
  }

  sections.push(`🧠 **Signal**\n${signalLines.join('\n')}`);
  sections.push(`📊 **Market Snapshot**\n${snapshotLines.join('\n')}`);
  sections.push(`📈 **Trade Strength**\n${tradeLines.join('\n')}`);
  sections.push(`🎯 **Verdict**\n${verdictLines.join('\n')}`);

  if ((scan.greenFlags && scan.greenFlags.length) || (scan.redFlags && scan.redFlags.length)) {
    const flagLines = [];
    if (scan.greenFlags?.length) flagLines.push(`🟢\n${formatReasonList(scan.greenFlags)}`);
    if (scan.redFlags?.length) flagLines.push(`🔴\n${formatReasonList(scan.redFlags)}`);
    sections.push(`⚠️ **Flags**\n${flagLines.join('\n\n')}`);
  }

  const links = buildLinksLine([
    scan.website ? `[Website](${scan.website})` : null,
    scan.twitter ? `[X / Twitter](${scan.twitter})` : null,
    scan.telegram ? `[Telegram](${scan.telegram})` : null
  ]);

  const linkBlock = [`\`${formatValue(scan.contractAddress, 'Unknown')}\``];
  if (links) linkBlock.push(links);
  sections.push(`🔗 **Links / Trade**\n${linkBlock.join('\n')}`);

  const embed = new EmbedBuilder()
    .setColor(0x00ff99)
    .setTitle(`🚀 ${tokenNameUpper} ($${tickerUpper})`)
    .setDescription(sections.join('\n\n'))
    .setFooter({ text: 'Crypto Scanner Bot • Trader Scan' })
    .setTimestamp();

  applyScanThumbnailToEmbed(embed, scan);

  if (options.chartImageUrl) {
    embed.setImage(options.chartImageUrl);
  }

  return embed;
}

/**
 * After !call / !watch: prefer OHLCV candlesticks (GeckoTerminal); fall back to line chart from tracked priceHistory.
 * Never uses priceHistory for candlesticks. Runs best-effort; failures only log.
 * @param {import('discord.js').Message} message
 * @param {object} scan
 * @param {object} [embedOptions]
 */
async function hydrateCallWatchChartMessage(message, scan, embedOptions = {}) {
  if (!message || typeof message.edit !== 'function') return;
  if (!scan) {
    console.error('[CallWatchChart]', '(no scan)', 'hydrate skipped');
    return;
  }
  try {
    let buf = null;
    let usedOhlcvCandlestick = false;

    try {
      const trackedForChart = getTrackedCall(scan.contractAddress);
      const overlay = getCandlestickOverlayProps(trackedForChart, scan);
      buf = await buildOhlcvCandlestickBuffer({
        pairAddress: scan.pairAddress,
        chain: 'solana',
        interval: '5m',
        limit: 96,
        title: scan.ticker || scan.tokenName || 'OHLC',
        ...overlay
      });
      if (buf) usedOhlcvCandlestick = true;
    } catch (ohlcvErr) {
      console.error('[CallWatchChart]', scan.contractAddress, 'ohlcv', ohlcvErr?.message || ohlcvErr);
      buf = null;
    }

    if (!buf) {
      const tracked = getTrackedCall(scan.contractAddress);
      const series = tracked ? seriesFromTrackedPriceHistory(tracked) : null;

      if (series) {
        try {
          buf = await renderPriceChart({
            prices: series.prices,
            timestamps: series.timestamps,
            label: scan.ticker || scan.tokenName || 'MC'
          });
        } catch (renderErr) {
          console.error('[CallWatchChart]', scan.contractAddress, renderErr.message);
          buf = null;
        }
      }
    }

    const embed = createTraderScanEmbed(scan, {
      ...embedOptions,
      chartPending: false,
      chartImageUrl: buf ? 'attachment://chart.png' : undefined
    });

    if (!buf) {
      await message.edit({ embeds: [embed] });
      return;
    }

    const file = new AttachmentBuilder(buf, { name: 'chart.png' });
    const editPayload = {
      embeds: [embed],
      files: [file]
    };
    if (usedOhlcvCandlestick) {
      editPayload.components = buildOhlcvTimeframeRows(scan.contractAddress, '5m');
    }
    await message.edit(editPayload);
  } catch (err) {
    console.error('[CallWatchChart]', scan?.contractAddress, err.message);
  }
}

function createScanEmbed(scan) {
  const callStatusLine = scan.callSourceType ? createCallStatusLine(scan) : '';
  const milestoneLine = formatMilestoneLine(scan.milestoneHit, scan.isNewCall, scan.isNewMilestone);
  const performanceLine = formatPerformanceLine(scan.performancePercent, scan.isNewCall);

  const embed = new EmbedBuilder()
    .setColor(0x00ff99)
    .setTitle(`🚨 ${scan.tokenName} (${scan.ticker})`)
    .setDescription(
      `## ${formatUsd(scan.marketCap)} MC\n` +
      `${callStatusLine}` +
      `${milestoneLine}` +
      `${performanceLine}` +
      `**${scan.alertType}**\n\n` +
      `**Momentum:** ${formatValue(scan.momentum)}\n` +
      `**Risk:** ${formatValue(scan.riskLevel)}\n` +
      `**Pressure:** ${formatValue(scan.tradePressure)}`
    )
    .addFields(
      {
        name: '🧾 Contract Address',
        value: `\`${formatValue(scan.contractAddress, 'Unknown')}\``,
        inline: false
      },
      {
        name: '🔗 Links',
        value: buildLinksLine([
          safeLink('Website', scan.website),
          safeLink('X / Twitter', scan.twitter),
          safeLink('Telegram', scan.telegram)
        ]) || 'No links found',
        inline: false
      },
      {
        name: '📊 Market Stats',
        value:
          `**Liquidity:** ${formatUsd(scan.liquidity)}\n` +
          `**Age:** ${scan.ageMinutes !== null ? `${scan.ageMinutes} min` : 'N/A'}\n` +
          `**Vol (5m):** ${formatUsd(scan.volume5m)}\n` +
          `**Vol (1h):** ${formatUsd(scan.volume1h)}\n` +
          `**Buy/Sell (5m):** ${formatValue(scan.buySellRatio5m, 'N/A')}\n` +
          `**Buy/Sell (1h):** ${formatValue(scan.buySellRatio1h, 'N/A')}`,
        inline: true
      },
      {
        name: '🎯 Scanner Verdict',
        value:
          `**Entry Score:** ${scan.entryScore}/100\n` +
          `**Grade:** ${scan.grade}\n` +
          `**Status:** ${scan.status}\n` +
          `**Conviction:** ${scan.conviction}`,
        inline: true
      }
    )
    .setFooter({ text: 'Crypto Scanner Bot • Simulated Alert' })
    .setTimestamp();

  if (scan.autoAlertPassReasons && scan.autoAlertPassReasons.length > 0) {
    embed.addFields(
      {
        name: '📡 Auto Alert Profile',
        value: formatProfileName(scan.autoAlertProfile),
        inline: false
      },
      {
        name: '✅ Why This Passed Auto Alert',
        value: formatReasonList(scan.autoAlertPassReasons),
        inline: false
      }
    );
  }

  return embed;
}

function calculatePerformance(current, firstCalled) {
  if (!current || !firstCalled || firstCalled === 0) return null;
  return ((current - firstCalled) / firstCalled) * 100;
}

function getMilestoneLabel(current, firstCalled) {
  if (!current || !firstCalled || firstCalled === 0) return null;
  const multiple = current / firstCalled;

  if (multiple >= 10) return '10x';
  if (multiple >= 4) return '4x';
  if (multiple >= 2) return '2x';
  return null;
}

async function applyTrackedCallState(contractAddress, message, marketCap, liveScanData, options = {}) {
  let wasNewCall = false;
  let wasReactivated = false;
  let wasUpgradedToUserCall = false;

  const existingCall = getTrackedCall(contractAddress);

  const callSourceType =
    options.callSourceType === 'watch_only'
      ? 'watch_only'
      : options.callSourceType === 'bot_call'
        ? 'bot_call'
        : 'user_call';

  if (!existingCall) {
    saveTrackedCall(
      {
        contractAddress,
        marketCap: marketCap || 0,
        tokenName: liveScanData?.tokenName || 'Unknown Token',
        ticker: liveScanData?.ticker || 'UNKNOWN',
        tokenImageUrl:
          liveScanData?.tokenImageUrl ||
          liveScanData?.token?.imageUrl ||
          null,
        latestMarketCap: marketCap || 0,
        entryScore: liveScanData?.entryScore || 0,
        grade: liveScanData?.grade || 'N/A',
        alertType: liveScanData?.alertType || 'N/A',
        ath: liveScanData?.ath || marketCap || 0,
        percentFromAth: liveScanData?.percentFromAth || 0,
        migrated: liveScanData?.migrated || false,
        holders: liveScanData?.holders ?? null,
        top10HolderPercent: liveScanData?.top10HolderPercent ?? null,
        devHoldingPercent: liveScanData?.devHoldingPercent ?? null,
        bundleHoldingPercent: liveScanData?.bundleHoldingPercent ?? null,
        sniperPercent: liveScanData?.sniperPercent ?? null
      },
      message.author.id,
      message.author.username,
      message.member?.displayName || message.author.globalName || message.author.username,
      { callSourceType }
    );
    wasNewCall = true;
  } else {
    const lifecycleStatus = existingCall.lifecycleStatus || 'active';
    const hoursSinceLastUpdate = getHoursSince(existingCall.lastUpdatedAt);

    const shouldReactivate =
      lifecycleStatus === 'archived' ||
      (lifecycleStatus === 'stagnant' &&
        hoursSinceLastUpdate !== null &&
        hoursSinceLastUpdate >= 12);

    if (shouldReactivate) {
      reactivateTrackedCall(
        {
          contractAddress,
          marketCap: marketCap || 0,
          tokenName: liveScanData?.tokenName || existingCall.tokenName,
          ticker: liveScanData?.ticker || existingCall.ticker,
          tokenImageUrl:
            liveScanData?.tokenImageUrl ||
            liveScanData?.token?.imageUrl ||
            existingCall.tokenImageUrl ||
            null,
          latestMarketCap: marketCap || existingCall.latestMarketCap || 0,
          entryScore: liveScanData?.entryScore || existingCall.entryScore || 0,
          grade: liveScanData?.grade || existingCall.grade || 'N/A',
          alertType: liveScanData?.alertType || existingCall.alertType || 'N/A',
          ath: liveScanData?.ath || existingCall.ath || marketCap || 0,
          percentFromAth: liveScanData?.percentFromAth || existingCall.percentFromAth || 0,
          migrated: liveScanData?.migrated || existingCall.migrated || false,
          holders: liveScanData?.holders ?? existingCall.holders ?? null,
          top10HolderPercent: liveScanData?.top10HolderPercent ?? existingCall.top10HolderPercent ?? null,
          devHoldingPercent: liveScanData?.devHoldingPercent ?? existingCall.devHoldingPercent ?? null,
          bundleHoldingPercent: liveScanData?.bundleHoldingPercent ?? existingCall.bundleHoldingPercent ?? null,
          sniperPercent: liveScanData?.sniperPercent ?? existingCall.sniperPercent ?? null
        },
        message.author.id,
        message.author.username,
        message.member?.displayName || message.author.globalName || message.author.username,
        { callSourceType }
      );
      wasReactivated = true;
    } else if (existingCall.callSourceType === 'watch_only' && callSourceType === 'user_call') {
      wasUpgradedToUserCall = true;
      saveTrackedCall(
        {
          contractAddress,
          marketCap: marketCap || 0,
          tokenName: liveScanData?.tokenName || existingCall.tokenName,
          ticker: liveScanData?.ticker || existingCall.ticker,
          tokenImageUrl:
            liveScanData?.tokenImageUrl ||
            liveScanData?.token?.imageUrl ||
            existingCall.tokenImageUrl ||
            null,
          latestMarketCap: marketCap || existingCall.latestMarketCap || 0,
          entryScore: liveScanData?.entryScore || existingCall.entryScore || 0,
          grade: liveScanData?.grade || existingCall.grade || 'N/A',
          alertType: liveScanData?.alertType || existingCall.alertType || 'N/A',
          ath: liveScanData?.ath || existingCall.ath || marketCap || 0,
          percentFromAth: liveScanData?.percentFromAth || existingCall.percentFromAth || 0,
          migrated: liveScanData?.migrated || existingCall.migrated || false,
          holders: liveScanData?.holders ?? existingCall.holders ?? null,
          top10HolderPercent: liveScanData?.top10HolderPercent ?? existingCall.top10HolderPercent ?? null,
          devHoldingPercent: liveScanData?.devHoldingPercent ?? existingCall.devHoldingPercent ?? null,
          bundleHoldingPercent: liveScanData?.bundleHoldingPercent ?? existingCall.bundleHoldingPercent ?? null,
          sniperPercent: liveScanData?.sniperPercent ?? existingCall.sniperPercent ?? null
        },
        message.author.id,
        message.author.username,
        message.member?.displayName || message.author.globalName || message.author.username,
        { callSourceType: 'user_call' }
      );
    } else {
      updateTrackedCallData(contractAddress, {
        tokenName: liveScanData?.tokenName || existingCall.tokenName,
        ticker: liveScanData?.ticker || existingCall.ticker,
        tokenImageUrl:
          (liveScanData?.tokenImageUrl && String(liveScanData.tokenImageUrl).trim()) ||
          (liveScanData?.token?.imageUrl && String(liveScanData.token.imageUrl).trim()) ||
          existingCall.tokenImageUrl ||
          null,
        latestMarketCap: marketCap || existingCall.latestMarketCap || 0,
        entryScore: liveScanData?.entryScore || existingCall.entryScore || 0,
        grade: liveScanData?.grade || existingCall.grade || 'N/A',
        alertType: liveScanData?.alertType || existingCall.alertType || 'N/A',
        ath: liveScanData?.ath || existingCall.ath || marketCap || 0,
        percentFromAth: liveScanData?.percentFromAth || existingCall.percentFromAth || 0,
        migrated: liveScanData?.migrated || existingCall.migrated || false,
        holders: liveScanData?.holders ?? existingCall.holders ?? null,
        top10HolderPercent: liveScanData?.top10HolderPercent ?? existingCall.top10HolderPercent ?? null,
        devHoldingPercent: liveScanData?.devHoldingPercent ?? existingCall.devHoldingPercent ?? null,
        bundleHoldingPercent: liveScanData?.bundleHoldingPercent ?? existingCall.bundleHoldingPercent ?? null,
        sniperPercent: liveScanData?.sniperPercent ?? existingCall.sniperPercent ?? null
      });
    }
  }

  const trackedCall = getTrackedCall(contractAddress);

  return {
    trackedCall,
    wasNewCall,
    wasReactivated
  };
}

async function runQuickCa(contractAddress) {
  return fetchRealTokenData(contractAddress);
}

async function runDeepScan(contractAddress) {
  return generateFakeScan(contractAddress);
}

async function handleQuickScanReply(message, contractAddress, withButtons = false) {
  const realData = await runQuickCa(contractAddress);

  const embed = createCompactCaEmbed(realData);

  const payload = { embeds: [embed] };

  if (withButtons) {
    payload.content = 'What would you like to do?';
    payload.components = buildActionButtons(contractAddress);
  }

  return message.reply(payload);
}

async function handleDeepScanReply(message, contractAddress, withButtons = false) {
  const scan = await runDeepScan(contractAddress);

  const { greenFlags, redFlags } = buildScanFlags({
    market: {
      liquidity: scan.liquidity,
      volume5m: scan.volume5m,
      volume1h: scan.volume1h
    },
    tradeSignals: {
      tradePressure: scan.tradePressure
    },
    socials: {
      dexPaid: scan.dexPaid
    }
  });

  const embed = createTraderScanEmbed({
    ...scan,
    greenFlags,
    redFlags,
    riskLevel: scan.riskLevel || 'Low',
    isNewCall: false,
    isReactivated: false
  }, {
    showTrackedMeta: false
  });

  const payload = { embeds: [embed] };

  if (withButtons) {
    payload.content = 'What would you like to do?';
    payload.components = buildActionButtons(contractAddress);
  }

  return message.reply(payload);
}

function isUserCallsWebhookUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim().replace(/\/+$/, ''));
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (
      host !== 'discord.com' &&
      host !== 'discordapp.com' &&
      host !== 'canary.discord.com' &&
      host !== 'ptb.discord.com'
    ) {
      return false;
    }
    return /^\/api\/webhooks\/\d+\/[^/?]+$/.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Dashboard "Submit call" — same pipeline as `!call` in #user-calls, optionally
 * preceded by a webhook line so it looks like the member typed `!call <ca>`.
 * @param {import('discord.js').Client} client
 * @param {{ userId: string, contractAddress: string, webhookUrl?: string | null }} opts
 */
async function handleCallFromDashboard(client, opts) {
  const userId = String(opts.userId || '').trim();
  const contractAddress = String(opts.contractAddress || '').trim();
  const webhookUrl = (opts.webhookUrl || '').trim();

  if (!userId || !contractAddress) {
    throw new Error('Missing userId or contract address');
  }

  const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();
  if (!guildId) {
    throw new Error('DISCORD_GUILD_ID is not configured');
  }

  const guild =
    client.guilds.cache.get(guildId) ||
    (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) {
    throw new Error('Bot is not in the configured guild (check DISCORD_GUILD_ID)');
  }

  const preferred = String(process.env.USER_CALLS_CHANNEL_NAME || 'user-calls')
    .trim()
    .toLowerCase();
  const namesToTry = [...new Set([preferred, 'user-calls', 'token-calls'])];
  let channel = null;
  for (const name of namesToTry) {
    channel = guild.channels.cache.find(
      c => c && c.isTextBased() && String(c.name || '').toLowerCase() === name
    );
    if (channel) break;
  }
  if (!channel) {
    throw new Error(
      `No text channel named #${preferred} (also tried #user-calls, #token-calls)`
    );
  }

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    throw new Error('That Discord account is not a member of this server');
  }

  let triggerMessageId = null;
  if (webhookUrl && isUserCallsWebhookUrl(webhookUrl)) {
    const displayName =
      member.displayName ||
      member.user.globalName ||
      member.user.username;
    const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
    const whBody = JSON.stringify({
      content: `!call ${contractAddress}`,
      username: String(displayName).slice(0, 80),
      avatar_url: avatarUrl,
      allowed_mentions: { parse: [] }
    });
    const whUrl = webhookUrl.includes('?')
      ? `${webhookUrl}&wait=true`
      : `${webhookUrl}?wait=true`;
    const whRes = await fetch(whUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: whBody
    });
    if (!whRes.ok) {
      const txt = await whRes.text().catch(() => '');
      throw new Error(`User-calls webhook failed (${whRes.status}): ${txt}`.trim());
    }
    const whJson = await whRes.json().catch(() => null);
    triggerMessageId = whJson && whJson.id ? String(whJson.id) : null;
  }

  const messageStub = {
    id: triggerMessageId || 'dashboard',
    author: member.user,
    member,
    channel,
    guild,
    content: `!call ${contractAddress}`,
    async reply(payload) {
      const out = { ...payload };
      if (triggerMessageId) {
        out.reply = { messageReference: triggerMessageId, failIfNotExists: false };
      }
      try {
        return await channel.send(out);
      } catch (err) {
        if (triggerMessageId && out.reply) {
          delete out.reply;
          return channel.send(out);
        }
        throw err;
      }
    }
  };

  return handleCallCommand(messageStub, contractAddress, 'dashboard');
}

/**
 * Dashboard "Watch" (public) — same pipeline as `!watch` in #user-calls, optionally
 * preceded by a webhook line so it looks like the member typed `!watch <ca>`.
 * @param {import('discord.js').Client} client
 * @param {{ userId: string, contractAddress: string, webhookUrl?: string | null }} opts
 */
async function handleWatchFromDashboard(client, opts) {
  const userId = String(opts.userId || '').trim();
  const contractAddress = String(opts.contractAddress || '').trim();
  const webhookUrl = (opts.webhookUrl || '').trim();

  if (!userId || !contractAddress) {
    throw new Error('Missing userId or contract address');
  }

  const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();
  if (!guildId) {
    throw new Error('DISCORD_GUILD_ID is not configured');
  }

  const guild =
    client.guilds.cache.get(guildId) ||
    (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) {
    throw new Error('Bot is not in the configured guild (check DISCORD_GUILD_ID)');
  }

  const preferred = String(process.env.USER_CALLS_CHANNEL_NAME || 'user-calls')
    .trim()
    .toLowerCase();
  const namesToTry = [...new Set([preferred, 'user-calls', 'token-calls'])];
  let channel = null;
  for (const name of namesToTry) {
    channel = guild.channels.cache.find(
      c => c && c.isTextBased() && String(c.name || '').toLowerCase() === name
    );
    if (channel) break;
  }
  if (!channel) {
    throw new Error(
      `No text channel named #${preferred} (also tried #user-calls, #token-calls)`
    );
  }

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    throw new Error('That Discord account is not a member of this server');
  }

  let triggerMessageId = null;
  if (webhookUrl && isUserCallsWebhookUrl(webhookUrl)) {
    const displayName =
      member.displayName ||
      member.user.globalName ||
      member.user.username;
    const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
    const whBody = JSON.stringify({
      content: `!watch ${contractAddress}`,
      username: String(displayName).slice(0, 80),
      avatar_url: avatarUrl,
      allowed_mentions: { parse: [] }
    });
    const whUrl = webhookUrl.includes('?')
      ? `${webhookUrl}&wait=true`
      : `${webhookUrl}?wait=true`;
    const whRes = await fetch(whUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: whBody
    });
    if (!whRes.ok) {
      const txt = await whRes.text().catch(() => '');
      throw new Error(`User-calls webhook failed (${whRes.status}): ${txt}`.trim());
    }
    const whJson = await whRes.json().catch(() => null);
    triggerMessageId = whJson && whJson.id ? String(whJson.id) : null;
  }

  const messageStub = {
    id: triggerMessageId || 'dashboard-watch',
    author: member.user,
    member,
    channel,
    guild,
    content: `!watch ${contractAddress}`,
    async reply(payload) {
      const out = { ...payload };
      if (triggerMessageId) {
        out.reply = { messageReference: triggerMessageId, failIfNotExists: false };
      }
      try {
        return await channel.send(out);
      } catch (err) {
        if (triggerMessageId && out.reply) {
          delete out.reply;
          return channel.send(out);
        }
        throw err;
      }
    }
  };

  return handleWatchCommand(messageStub, contractAddress, 'dashboard');
}

async function handleCallCommand(message, contractAddress, source = 'command') {
  const realData = await runQuickCa(contractAddress);
  const scan = normalizeRealDataToScan(realData);

  const { trackedCall, wasNewCall, wasReactivated, wasUpgradedToUserCall } =
    await applyTrackedCallState(
    contractAddress,
    message,
    scan.marketCap || 0,
    scan,
    { callSourceType: 'user_call' }
  );

  const performancePercent = trackedCall
    ? calculatePerformance(scan.marketCap || 0, trackedCall.firstCalledMarketCap)
    : null;

  const milestoneHit = trackedCall
    ? getMilestoneLabel(scan.marketCap || 0, trackedCall.firstCalledMarketCap)
    : null;

  const { greenFlags, redFlags } = buildScanFlags(realData);

  const embedScan = {
    ...scan,
    greenFlags,
    redFlags,
    riskLevel: scan.riskLevel || 'Low',
    firstCallerUsername: trackedCall?.firstCallerUsername,
    firstCallerDisplayName: trackedCall?.firstCallerDisplayName,
    firstCallerDiscordId: trackedCall?.firstCallerDiscordId,
    firstCalledMarketCap: trackedCall?.firstCalledMarketCap,
    lifecycleStatus: trackedCall?.lifecycleStatus,
    callSourceType: trackedCall?.callSourceType,
    isNewCall: wasNewCall,
    isReactivated: wasReactivated,
    performancePercent,
    milestoneHit,
    isNewMilestone: false
  };

  const callChartPending = wasNewCall || wasReactivated;

  const embed = createTraderScanEmbed(embedScan, {
    showTrackedMeta: true,
    chartPending: callChartPending
  });

  const alreadyCalled = !wasNewCall && !wasReactivated && !wasUpgradedToUserCall;
  const replyContent = wasNewCall
    ? '🆕 First call — coin is now being tracked.'
    : wasReactivated
      ? '♻️ Reactivated — coin is being tracked again.'
      : wasUpgradedToUserCall
        ? '📍 Upgraded — moved from watchlist to an official call.'
        : '🧠 This coin has already been called.';

  const reply = await message.reply({
    content: replyContent,
    embeds: [embed]
  });

  const freshTracked = getTrackedCall(contractAddress) || trackedCall;
  const callerId = String(freshTracked?.firstCallerDiscordId || '').trim();
  const shouldMirrorStats =
    freshTracked &&
    freshTracked.callSourceType === 'user_call' &&
    callerId &&
    callerId.toUpperCase() !== 'AUTO_BOT' &&
    (wasNewCall || wasUpgradedToUserCall);

  /** For dashboard / internal API: attach non-enumerable payload without breaking Discord.js return type. */
  let statsMirrorResult = null;
  if (shouldMirrorStats) {
    try {
      const guildId = message.guild?.id || message.guildId;
      const channelId = message.channel?.id;
      const replyId = reply?.id;
      const messageUrl =
        guildId && channelId && replyId
          ? `https://discord.com/channels/${guildId}/${channelId}/${replyId}`
          : null;
      const { insertUserCallPerformanceRow } = require('../utils/callPerformanceSync');
      statsMirrorResult = await insertUserCallPerformanceRow(freshTracked, { messageUrl });
      if (!statsMirrorResult.ok) {
        console.error('[CallPerformanceSync] mirror failed:', statsMirrorResult);
      }
    } catch (err) {
      console.error('[CallPerformanceSync] mirror user call:', err?.message || err);
      statsMirrorResult = { ok: false, error: err?.message || String(err) };
    }
  }

  hydrateCallWatchChartMessage(reply, embedScan, { showTrackedMeta: true }).catch(err => {
    console.error('[CallWatchChart]', embedScan?.contractAddress, err.message);
  });

  if (reply && typeof reply === 'object' && statsMirrorResult != null) {
    try {
      /** Shown in POST /internal/call JSON (must be JSON-serializable). */
      reply.statsMirror = statsMirrorResult;
    } catch (_) {
      /* ignore if message object rejects the property */
    }
  }

  if (reply && typeof reply === 'object') {
    try {
      reply.callMeta = {
        wasNewCall: Boolean(wasNewCall),
        wasReactivated: Boolean(wasReactivated),
        wasUpgradedToUserCall: Boolean(wasUpgradedToUserCall),
        alreadyCalled
      };
    } catch (_) {
      /* ignore if message object rejects the property */
    }
  }

  return reply;
}

async function handleWatchCommand(message, contractAddress, source = 'command') {
  const realData = await runQuickCa(contractAddress);
  const scan = normalizeRealDataToScan(realData);

  const { trackedCall, wasNewCall, wasReactivated } = await applyTrackedCallState(
    contractAddress,
    message,
    scan.marketCap || 0,
    scan,
    { callSourceType: 'watch_only' }
  );

  const performancePercent = trackedCall
    ? calculatePerformance(scan.marketCap || 0, trackedCall.firstCalledMarketCap)
    : null;

  const milestoneHit = trackedCall
    ? getMilestoneLabel(scan.marketCap || 0, trackedCall.firstCalledMarketCap)
    : null;

  const { greenFlags, redFlags } = buildScanFlags(realData);

  const embedScan = {
    ...scan,
    greenFlags,
    redFlags,
    riskLevel: scan.riskLevel || 'Low',
    firstCallerUsername: trackedCall?.firstCallerUsername,
    firstCallerDisplayName: trackedCall?.firstCallerDisplayName,
    firstCallerDiscordId: trackedCall?.firstCallerDiscordId,
    firstCalledMarketCap: trackedCall?.firstCalledMarketCap,
    lifecycleStatus: trackedCall?.lifecycleStatus,
    callSourceType: trackedCall?.callSourceType,
    isNewCall: wasNewCall,
    isReactivated: wasReactivated,
    performancePercent,
    milestoneHit,
    isNewMilestone: false
  };

  const embed = createTraderScanEmbed(embedScan, {
    showTrackedMeta: true
  });

  const reply = await message.reply({
    content: '👀 Added to watchlist tracking (no caller credit).',
    embeds: [embed]
  });

  hydrateCallWatchChartMessage(reply, embedScan, { showTrackedMeta: true }).catch(err => {
    console.error('[CallWatchChart]', embedScan?.contractAddress, err.message);
  });

  return reply;
}

async function handleBasicCommands(message, options = {}) {
  if (message.author.bot) return false;

  const content = message.content.trim();
  const lowerContent = content.toLowerCase();

  const scanChannelNames = options.scanChannelNames || [
    'scanner',
    'scanner-feed',
    'calls',
    'coin-calls',
    'user-calls',
    'token-calls'
  ];
  const isScannerStyleChannel = scanChannelNames.includes(String(message.channel?.name || '').toLowerCase());

  if (lowerContent === '!ping') {
    await message.reply('Pong!');
    return true;
  }

  if (lowerContent === '!help' || lowerContent === '!commands') {
    const embed = createCommandsEmbed(message);
    await message.reply({ embeds: [embed] });
    return true;
  }

  if (lowerContent === '!status') {
    await message.reply('🟢 Crypto Scanner Bot is online and ready.');
    return true;
  }

  if (lowerContent.startsWith('!callerboard')) {
    const leaderboard = getCallerLeaderboard(10);

    if (!leaderboard.length) {
      await message.reply('No caller data available yet.');
      return true;
    }

    const lines = leaderboard.map((c, i) => {
      return `#${i + 1} **${c.username}** — Avg ${c.avgX.toFixed(2)}x | ${c.totalCalls} calls`;
    });

    await message.reply(lines.join('\n'));
    return true;
  }

  if (lowerContent.startsWith('!caller ')) {
    const input = content.replace('!caller ', '').trim();

    if (!input) {
      await message.reply('Usage: `!caller [username]`');
      return true;
    }

    const stats = getCallerStats(input);

    if (!stats) {
      await message.reply('No stats found for that caller.');
      return true;
    }

    const lines = [
      `👤 **${stats.username}**`,
      `Calls: ${stats.totalCalls}`,
      `Avg X: ${stats.avgX.toFixed(2)}x`,
      `Avg ATH: ${formatUsd(stats.avgAth)}`,
      stats.bestCall
        ? `🏆 Best: ${stats.bestCall.tokenName} (${stats.bestCall.ticker}) — ${stats.bestCall.x.toFixed(2)}x`
        : ''
    ].filter(Boolean);

    await message.reply(lines.join('\n'));
    return true;
  }

  if (lowerContent === '!botstats') {
    const stats = getBotStats();

    if (!stats) {
      await message.reply('No bot stats yet.');
      return true;
    }

    const lines = [
      `🤖 **Auto Bot**`,
      `Calls: ${stats.totalCalls}`,
      `Avg X: ${stats.avgX.toFixed(2)}x`,
      `Avg ATH: ${formatUsd(stats.avgAth)}`,
      stats.bestCall
        ? `🏆 Best: ${stats.bestCall.tokenName} (${stats.bestCall.ticker}) — ${stats.bestCall.x.toFixed(2)}x`
        : ''
    ].filter(Boolean);

    await message.reply(lines.join('\n'));
    return true;
  }

  if (lowerContent.startsWith('!tracked')) {
    const parts = content.split(' ');
    const contractAddress = parts[1] || null;
    const calls = loadTrackedCalls();

    if (!contractAddress) {
      const embed = createTrackedSummaryEmbed(calls);
      await message.reply({ embeds: [embed] });
      return true;
    }

    const existingTrackedCall = getTrackedCall(contractAddress);

    if (!existingTrackedCall) {
      await message.reply('⚠️ That contract address is not currently in tracked calls.');
      return true;
    }

    const refreshedTrackedCall = await refreshTrackedCallLive(contractAddress);
    const embed = createTrackedDetailEmbed(refreshedTrackedCall);

    await message.reply({ embeds: [embed] });
    return true;
  }

  if (lowerContent.startsWith('!testreal')) {
    const parts = content.split(' ');
    const contractAddress = parts[1];

    if (!contractAddress) {
      await message.reply('⚠️ Usage: `!testreal [SOLANA_CONTRACT_ADDRESS]`');
      return true;
    }

    try {
      const realData = await fetchRealTokenData(contractAddress);
      const embed = createRealTestEmbed(realData);
      await message.reply({ embeds: [embed] });
      return true;
    } catch (error) {
      console.error(error);
      await message.reply(`❌ Real provider test failed: ${error.message}`);
      return true;
    }
  }

  if (lowerContent.startsWith('!autoscantest')) {
    const parts = content.split(' ');
    const requestedProfile = (parts[1] || 'balanced').toLowerCase();

    const validProfiles = ['conservative', 'balanced', 'aggressive'];
    const profile = validProfiles.includes(requestedProfile) ? requestedProfile : 'balanced';

    const scans = await generateBatchScans(8, profile);

    if (scans.length === 0) {
      await message.reply(`⚠️ No simulated setups passed the **${formatProfileName(profile)}** auto-alert filter this round.`);
      return true;
    }

    await message.reply(
      `📡 Auto Scan Test (**${formatProfileName(profile)}**) found **${scans.length}** qualifying setup(s). Posting alerts...`
    );

    for (const scan of scans) {
      const embed = createScanEmbed(scan);
      await message.channel.send({ embeds: [embed] });
    }

    return true;
  }

  if (lowerContent.startsWith('!ca')) {
    const parts = content.split(' ');
    const contractAddress = parts[1];

    if (!contractAddress) {
      await message.reply('⚠️ Usage: `!ca [SOLANA_CONTRACT_ADDRESS]`');
      return true;
    }

    try {
      await handleQuickScanReply(message, contractAddress, true);
      return true;
    } catch (error) {
      console.error(error);
      await message.reply(`❌ Quick CA scan failed: ${error.message}`);
      return true;
    }
  }

  if (lowerContent === '!scan') {
    const scan = await generateFakeScan();
    const embed = createTraderScanEmbed(scan, { showTrackedMeta: false });
    await message.reply({ embeds: [embed] });
    return true;
  }

  if (lowerContent.startsWith('!scan ')) {
    const parts = content.split(' ');
    const contractAddress = parts[1];

    if (!contractAddress) {
      await message.reply('⚠️ Usage: `!scan [SOLANA_CONTRACT_ADDRESS]`');
      return true;
    }

    try {
      await handleDeepScanReply(message, contractAddress, true);
      return true;
    } catch (error) {
      console.error(error);
      await message.reply(`❌ Scan failed: ${error.message}`);
      return true;
    }
  }

  if (lowerContent.startsWith('!call ')) {
    const parts = content.split(' ');
    const contractAddress = parts[1];

    if (!contractAddress) {
      await message.reply('⚠️ Usage: `!call [SOLANA_CONTRACT_ADDRESS]`');
      return true;
    }

    try {
      await handleCallCommand(message, contractAddress, 'command');
      return true;
    } catch (error) {
      console.error(error);
      await message.reply(`❌ Call failed: ${error.message}`);
      return true;
    }
  }

  if (lowerContent.startsWith('!watch ')) {
    const parts = content.split(' ');
    const contractAddress = parts[1];

    if (!contractAddress) {
      await message.reply('⚠️ Usage: `!watch [SOLANA_CONTRACT_ADDRESS]`');
      return true;
    }

    try {
      await handleWatchCommand(message, contractAddress, 'command');
      return true;
    } catch (error) {
      console.error(error);
      await message.reply(`❌ Watch failed: ${error.message}`);
      return true;
    }
  }

  if (isLikelySolanaCA(content)) {
    try {
      if (isScannerStyleChannel) {
        await handleDeepScanReply(message, content, false);
      } else {
        await handleQuickScanReply(message, content, false);
      }
      return true;
    } catch (error) {
      console.error(error);
      await message.reply(`❌ Contract scan failed: ${error.message}`);
      return true;
    }
  }

  return false;
}

module.exports = {
  handleBasicCommands,
  buildActionButtons,
  buildDisabledActionButtons,
  handleCallCommand,
  handleCallFromDashboard,
  handleWatchFromDashboard,
  handleWatchCommand,
  isLikelySolanaCA
};