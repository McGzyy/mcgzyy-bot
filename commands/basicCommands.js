const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder
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
const {
  isMilestoneChartAttachmentEnabled,
  fetchTokenChartImageBuffer
} = require('../utils/tokenChartImage');
const { getAlertEmbedLayoutMode } = require('../config/alertEmbedLayout');
const { getCallerTrustLevel } = require('../utils/userProfileService');

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

/** Same semantics as userProfileService.normalizeString — used by resolveTrackedCallCallerContext (X intake plain object). */
function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function yesNo(value) {
  return value ? 'Yes' : 'No';
}

function formatReasonList(reasons) {
  if (!reasons || reasons.length === 0) return 'None';
  return reasons.map(reason => `• ${reason}`).join('\n');
}

/** Compact single-line rows for Green/Red flag lists (details + single-embed layouts). */
function formatScanFlagsInline(scan) {
  const greens = Array.isArray(scan.greenFlags) ? scan.greenFlags.filter(Boolean) : [];
  const reds = Array.isArray(scan.redFlags) ? scan.redFlags.filter(Boolean) : [];
  const lines = [];
  if (greens.length) lines.push(`🟢 **Green:** ${greens.join(' • ')}`);
  if (reds.length) lines.push(`🔴 **Red:** ${reds.join(' • ')}`);
  return lines.join('\n');
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

/** Strong call-card title: 🎯 Name ($TICK) with redundant ticker dropped. */
function formatCallAlertEmbedTitle(scan) {
  const name = formatValue(scan.tokenName, 'Token').trim();
  let tick = formatValue(scan.ticker, '').trim().replace(/^\$+/, '');
  const nameLower = name.toLowerCase();
  const tickLower = tick.toLowerCase();
  if (tick && (tickLower === nameLower || nameLower.includes(tickLower))) {
    tick = '';
  }
  const tickShow = tick ? (tick.startsWith('$') ? tick : `$${tick}`) : '';
  let title = tickShow ? `🎯 ${name} (${tickShow})` : `🎯 ${name}`;
  if (title.length > 250) {
    title = `${title.slice(0, 247)}…`;
  }
  return title;
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

  return {
    tokenName: realData.token?.tokenName || 'Unknown Token',
    ticker: realData.token?.ticker || 'UNKNOWN',
    contractAddress: realData.token?.contractAddress || 'Unknown',
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

    entryScore: score,
    grade: getQuickGrade(score),
    alertType: getQuickAlertType(score),
    status: score >= 70 ? 'Strong' : score >= 55 ? 'Watch' : 'Risky',
    conviction: score >= 80 ? 'High' : score >= 60 ? 'Moderate' : 'Low',
    riskLevel: getRiskLabel(realData)
  };
}

async function refreshTrackedCallLive(contractAddress) {
  try {
    const realData = await fetchRealTokenData(contractAddress);
    const score = calculateQuickRealScore(realData);

    updateTrackedCallData(contractAddress, {
      tokenName: realData.token?.tokenName || 'Unknown Token',
      ticker: realData.token?.ticker || 'UNKNOWN',
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

function createCommandsEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📘 Crypto Scanner Bot — Command cheat sheet')
    .setDescription(
      'Short reference. **Full list:** type `!help` or `!commands` in Discord (plain-text list, includes mod/owner commands if you have access).'
    )
    .addFields(
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
          '`!profile` / `!myprofile` — profile + X verify (use **#verify-x** too)\n' +
          '`!credit` anonymous|discord|xtag — public credit label',
        inline: false
      },
      {
        name: '🛠 More (text `!help`)',
        value:
          'Highlights: `!bestcall24h` … `!addlaunch` … `!devleaderboard`\n' +
          '**Manage Server:** `!scanner` / `!scanner on|off`, approvals, `!pendingapprovals`, `!verifyx @user`, `!resetmonitor`, …\n' +
          '**Bot owner:** scanner thresholds & sanity filters — see `!help` (`!testx` / channel permissions)',
        inline: false
      }
    )
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

  const xHandle = scan.xMentionAttributionHandle
    ? String(scan.xMentionAttributionHandle).trim().replace(/^@+/, '')
    : '';

  const sourceLine =
    scan.callSourceType === 'watch_only'
      ? `👀 **Watch Only • No caller credit**`
      : scan.callSourceType === 'bot_call'
        ? `🤖 **Bot Tracked Coin**`
        : xHandle
          ? `🐦 **Called via X by @${xHandle} @ ${formatCompactUsd(scan.firstCalledMarketCap)} MC**`
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

function collectTraderScanEmbedFields(scan) {
  const fields = [];

  fields.push({
    name: '🧾 Contract Address',
    value: `\`${formatValue(scan.contractAddress, 'Unknown')}\``,
    inline: false
  });

  const links = buildLinksLine([
    scan.website ? `[Website](${scan.website})` : null,
    scan.twitter ? `[X / Twitter](${scan.twitter})` : null,
    scan.telegram ? `[Telegram](${scan.telegram})` : null
  ]);

  if (links) {
    fields.push({
      name: '🔗 Links',
      value: links,
      inline: false
    });
  }

  {
    const flagsVal = formatScanFlagsInline(scan);
    if (flagsVal) {
      fields.push({
        name: '🚨 Scan Flags',
        value: flagsVal,
        inline: false
      });
    }
  }

  const marketLines = [];
  addLineIfMeaningful(marketLines, 'Market Cap', scan.marketCap, formatUsd, { type: 'number' });
  addLineIfMeaningful(marketLines, 'Liquidity', scan.liquidity, formatUsd, { type: 'number' });
  addLineIfMeaningful(marketLines, 'Vol (5m)', scan.volume5m, formatUsd, { type: 'number' });
  addLineIfMeaningful(marketLines, 'Vol (1h)', scan.volume1h, formatUsd, { type: 'number' });
  addLineIfMeaningful(
    marketLines,
    'Age',
    scan.ageMinutes,
    (v) => `${v} min`,
    { type: 'number', allowZero: true }
  );
  addLineIfMeaningful(
    marketLines,
    'Holders',
    scan.holders,
    (v) => String(v),
    { type: 'number', allowZero: false }
  );

  addFieldIfHasContent(fields, '📊 Market Setup', marketLines, true);

  const tradeLines = [];
  addLineIfMeaningful(tradeLines, 'Buy/Sell (5m)', scan.buySellRatio5m, (v) => String(v));
  addLineIfMeaningful(tradeLines, 'Buy/Sell (1h)', scan.buySellRatio1h, (v) => String(v));
  addLineIfMeaningful(tradeLines, 'Trade Quality', getTradeQualityLabel(scan));

  addFieldIfHasContent(fields, '📈 Trade Strength', tradeLines, true);

  const verdictLines = [
    `**Entry Score:** ${scan.entryScore}/100`,
    `**Grade:** ${scan.grade}`,
    `**Status:** ${scan.status}`,
    `**Conviction:** ${scan.conviction}`
  ];

  addFieldIfHasContent(fields, '🎯 Trader Verdict', verdictLines, true);

  return fields;
}

/** Caller / milestone / performance only — Layout B hero carries setup pulse; avoids duplicating alert lines. */
function buildDetailsNarrativeOnly(scan, showTrackedMeta) {
  const callStatusLine = showTrackedMeta && scan.callSourceType ? createCallStatusLine(scan) : '';
  const milestoneLine = showTrackedMeta ? formatMilestoneLine(scan.milestoneHit, scan.isNewCall, scan.isNewMilestone) : '';
  const performanceLine = showTrackedMeta ? formatPerformanceLine(scan.performancePercent, scan.isNewCall) : '';
  return `${callStatusLine}${milestoneLine}${performanceLine}`.trim();
}

/** Layout B second card: grouped fields, less wall-of-stats. */
function collectGroupedTraderDetailsFields(scan) {
  const fields = [];

  fields.push({
    name: '🧾 CA',
    value: `\`${formatValue(scan.contractAddress, 'Unknown')}\``,
    inline: false
  });

  const links = buildLinksLine([
    scan.website ? `[Website](${scan.website})` : null,
    scan.twitter ? `[X / Twitter](${scan.twitter})` : null,
    scan.telegram ? `[Telegram](${scan.telegram})` : null
  ]);
  fields.push({
    name: '🔗 Links',
    value: links || '*—*',
    inline: false
  });

  {
    const flagsVal = formatScanFlagsInline(scan);
    if (flagsVal) {
      fields.push({
        name: '🚦 Flags',
        value: flagsVal,
        inline: false
      });
    }
  }

  const snap = [];
  addLineIfMeaningful(snap, 'MC', scan.marketCap, formatUsd, { type: 'number' });
  addLineIfMeaningful(snap, 'Liq', scan.liquidity, formatUsd, { type: 'number' });
  addLineIfMeaningful(snap, 'Vol 5m', scan.volume5m, formatUsd, { type: 'number' });
  addLineIfMeaningful(snap, 'Vol 1h', scan.volume1h, formatUsd, { type: 'number' });
  addLineIfMeaningful(snap, 'Age', scan.ageMinutes, (v) => `${v}m`, { type: 'number', allowZero: true });
  addLineIfMeaningful(snap, 'Holders', scan.holders, (v) => String(v), { type: 'number', allowZero: false });
  if (snap.length) {
    fields.push({
      name: '💧 Market',
      value: snap.join(' · '),
      inline: false
    });
  }

  const flow = [];
  addLineIfMeaningful(flow, 'B/S 5m', scan.buySellRatio5m, (v) => String(v));
  addLineIfMeaningful(flow, 'B/S 1h', scan.buySellRatio1h, (v) => String(v));
  addLineIfMeaningful(flow, 'Tape', getTradeQualityLabel(scan));
  if (flow.length) {
    fields.push({
      name: '⚡ Flow',
      value: flow.join(' · '),
      inline: false
    });
  }

  fields.push({
    name: '⚖️ Read',
    value: `**${formatValue(scan.status)}** · ${formatValue(scan.conviction)} · **${scan.entryScore}/100** · **${formatValue(scan.grade)}**`,
    inline: false
  });

  return fields;
}

function buildLayoutBHeroDescription(scan, chartPhase) {
  const mcVal = formatUsd(scan.marketCap);
  const mcHead = `## **${mcVal}**`;
  const mcSub = '*MC · snapshot*';
  const setup = `**${formatValue(scan.alertType, 'Setup')}** · ${scan.entryScore}/100 · **${formatValue(scan.grade, '—')}**`;
  const pulse = `**Pulse** ${getDisplayMomentum(scan)} · **Risk** ${formatValue(scan.riskLevel)} · **Press.** ${formatValue(
    scan.tradePressure,
    '—'
  )}`;
  const loading = chartPhase === 'loading' ? '\n*⏳ Loading chart…*' : '';
  return `${mcHead}\n${mcSub}\n${setup}\n${pulse}${loading}`;
}

/** Call / milestone / performance / alert type / momentum — lives on the details embed (Layout B) or below MC (A/C). */
function buildTraderScanNarrativeBlock(scan, showTrackedMeta) {
  const callStatusLine = showTrackedMeta && scan.callSourceType ? createCallStatusLine(scan) : '';
  const milestoneLine = showTrackedMeta ? formatMilestoneLine(scan.milestoneHit, scan.isNewCall, scan.isNewMilestone) : '';
  const performanceLine = showTrackedMeta ? formatPerformanceLine(scan.performancePercent, scan.isNewCall) : '';

  const displayMomentum = getDisplayMomentum(scan);
  const descLines = [
    `**Momentum:** ${displayMomentum}`,
    `**Risk:** ${formatValue(scan.riskLevel)}`,
    `**Pressure:** ${formatValue(scan.tradePressure, 'Unknown')}`
  ];

  return (
    `${callStatusLine}${milestoneLine}${performanceLine}` +
    `**${scan.alertType}**` +
    (descLines.length ? `\n\n${descLines.join('\n')}` : '')
  ).trim();
}

function buildTraderDetailsEmbed(scan, showTrackedMeta) {
  const narrative = buildDetailsNarrativeOnly(scan, showTrackedMeta);
  const embed = new EmbedBuilder()
    .setColor(0x047857)
    .addFields(...collectGroupedTraderDetailsFields(scan))
    .setFooter({ text: 'Crypto Scanner · Intel' })
    .setTimestamp();

  if (narrative) {
    embed.setDescription(narrative);
  }

  return embed;
}

/**
 * Two-embed trader card so the chart image sits high (Discord renders image below description, not below fields).
 * @returns {{ embeds: EmbedBuilder[], chartEmbedIndex: number }}
 */
function buildTraderScanEmbeds(scan, options = {}) {
  const showTrackedMeta = options.showTrackedMeta === true;
  const chartPhase = options.chartPhase === 'loading' ? 'loading' : 'none';
  const layout = options.layout || getAlertEmbedLayoutMode();

  const mcBlock = `## ${formatUsd(scan.marketCap)} MC\n`;
  const color = 0x00ff99;

  if (layout === 'A') {
    const chartEmbed = new EmbedBuilder()
      .setColor(color)
      .setDescription(chartPhase === 'loading' ? '⏳ Loading chart...' : '\u200b');
    const narrative = buildTraderScanNarrativeBlock(scan, showTrackedMeta);
    const mainBody = `${mcBlock}${narrative}`.trim();
    const main = new EmbedBuilder()
      .setColor(color)
      .setTitle(formatCallAlertEmbedTitle(scan))
      .setDescription(mainBody)
      .addFields(...collectTraderScanEmbedFields(scan))
      .setFooter({ text: 'Crypto Scanner Bot • Call details' })
      .setTimestamp();
    return { embeds: [chartEmbed, main], chartEmbedIndex: 0 };
  }

  if (layout === 'C') {
    const chartEmbed = new EmbedBuilder()
      .setColor(color)
      .setDescription(chartPhase === 'loading' ? '⏳ Loading chart...' : '\u200b');
    const compactHeader = `**${scan.tokenName} (${scan.ticker})** — **${formatUsd(scan.marketCap)}** MC`;
    const narrative = buildTraderScanNarrativeBlock(scan, showTrackedMeta);
    const main = new EmbedBuilder()
      .setColor(color)
      .setDescription(`${compactHeader}\n\n${narrative}`.trim())
      .addFields(...collectTraderScanEmbedFields(scan))
      .setFooter({ text: 'Crypto Scanner Bot • Call details' })
      .setTimestamp();
    return { embeds: [chartEmbed, main], chartEmbedIndex: 0 };
  }

  const hero = new EmbedBuilder()
    .setColor(0x34d399)
    .setTitle(formatCallAlertEmbedTitle(scan))
    .setDescription(buildLayoutBHeroDescription(scan, chartPhase));
  const details = buildTraderDetailsEmbed(scan, showTrackedMeta);
  return { embeds: [hero, details], chartEmbedIndex: 0 };
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

/**
 * Caller fields for tracked-call intake (Discord message or plain object for non-Discord sources).
 * @typedef {{ discordUserId: string, username: string, displayName: string }} TrackedCallCallerContext
 */

function isDiscordMessageLike(value) {
  return (
    value &&
    typeof value === 'object' &&
    value.author &&
    typeof value.author.id === 'string'
  );
}

/**
 * Build caller context from a Discord.js message (same rules as legacy applyTrackedCallState).
 * @returns {TrackedCallCallerContext|null}
 */
function buildTrackedCallCallerContextFromDiscordMessage(message) {
  if (!message?.author?.id) return null;

  return {
    discordUserId: String(message.author.id),
    username: message.author.username || '',
    displayName:
      message.member?.displayName ||
      message.author.globalName ||
      message.author.username ||
      ''
  };
}

/**
 * Normalize Discord message or explicit context for saveTrackedCall / reactivateTrackedCall.
 * @param {import('discord.js').Message | TrackedCallCallerContext} messageOrContext
 * @returns {TrackedCallCallerContext|null}
 */
function resolveTrackedCallCallerContext(messageOrContext) {
  if (isDiscordMessageLike(messageOrContext)) {
    return buildTrackedCallCallerContextFromDiscordMessage(messageOrContext);
  }

  if (!messageOrContext || typeof messageOrContext !== 'object') return null;

  const discordUserId =
    messageOrContext.discordUserId != null ? String(messageOrContext.discordUserId).trim() : '';
  if (!discordUserId) return null;

  const username = normalizeString(messageOrContext.username) || 'Unknown';
  const displayName =
    normalizeString(messageOrContext.displayName) ||
    normalizeString(messageOrContext.username) ||
    username;

  return { discordUserId, username, displayName };
}

/**
 * Apply scan + caller to tracked-call storage.
 * @param {string} contractAddress
 * @param {import('discord.js').Message | TrackedCallCallerContext} messageOrCallerContext — Discord message or { discordUserId, username, displayName }
 * @param {number} marketCap
 * @param {object} liveScanData
 * @param {object} [options]
 * @param {'user_call'|'watch_only'|'bot_call'} [options.callSourceType]
 * @param {string} [options.intakeSource] — e.g. `discord_message`, `x_mention` (for future logging / persistence)
 */
async function applyTrackedCallState(
  contractAddress,
  messageOrCallerContext,
  marketCap,
  liveScanData,
  options = {}
) {
  let wasNewCall = false;
  let wasReactivated = false;

  const caller = resolveTrackedCallCallerContext(messageOrCallerContext);
  if (!caller) {
    console.error('[TrackedCalls] applyTrackedCallState: missing or invalid caller context');
    return {
      trackedCall: getTrackedCall(contractAddress),
      wasNewCall: false,
      wasReactivated: false
    };
  }

  const { discordUserId, username, displayName } = caller;

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
      discordUserId,
      username,
      displayName,
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
        discordUserId,
        username,
        displayName,
        { callSourceType }
      );
      wasReactivated = true;
    } else if (existingCall.callSourceType === 'watch_only' && callSourceType === 'user_call') {
      saveTrackedCall(
        {
          contractAddress,
          marketCap: marketCap || 0,
          tokenName: liveScanData?.tokenName || existingCall.tokenName,
          ticker: liveScanData?.ticker || existingCall.ticker,
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
        discordUserId,
        username,
        displayName,
        { callSourceType: 'user_call' }
      );
      // First attributed user call on this row — same signal as a brand-new row for X reply policy (wasNewCall).
      wasNewCall = true;
    } else if (existingCall.callSourceType === 'bot_call' && callSourceType === 'user_call') {
      saveTrackedCall(
        {
          contractAddress,
          marketCap: marketCap || 0,
          tokenName: liveScanData?.tokenName || existingCall.tokenName,
          ticker: liveScanData?.ticker || existingCall.ticker,
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
        discordUserId,
        username,
        displayName,
        { callSourceType: 'user_call' }
      );
      wasNewCall = true;
    } else {
      updateTrackedCallData(contractAddress, {
        tokenName: liveScanData?.tokenName || existingCall.tokenName,
        ticker: liveScanData?.ticker || existingCall.ticker,
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

  const { embeds } = buildTraderScanEmbeds(
    {
      ...scan,
      greenFlags,
      redFlags,
      riskLevel: scan.riskLevel || 'Low',
      isNewCall: false,
      isReactivated: false
    },
    {
      showTrackedMeta: false
    }
  );

  const payload = { embeds };

  if (withButtons) {
    payload.content = 'What would you like to do?';
    payload.components = buildActionButtons(contractAddress);
  }

  return message.reply(payload);
}

/**
 * Same content + embed as `!call` / `handleCallCommand` (for channel mirror + X intake).
 * @param {{ chartPhase?: string, layout?: string, xOriginHandle?: string, proCall?: { title?: string, why?: string, risk?: string, tweetUrl?: string } }} [embedExtras]
 *        xOriginHandle: X-only; folds into embed “Called by” line, not message content.
 *        proCall: trusted_pro narrative (Discord-only in v1).
 * @returns {{ content: string, embeds: import('discord.js').EmbedBuilder[], chartEmbedIndex: number }}
 */
function buildUserCallAnnouncementPayload(realData, scan, trackedCall, wasNewCall, wasReactivated, embedExtras = {}) {
  const performancePercent = trackedCall
    ? calculatePerformance(scan.marketCap || 0, trackedCall.firstCalledMarketCap)
    : null;

  const milestoneHit = trackedCall
    ? getMilestoneLabel(scan.marketCap || 0, trackedCall.firstCalledMarketCap)
    : null;

  const { greenFlags, redFlags } = buildScanFlags(realData);

  const chartPhase = embedExtras.chartPhase === 'loading' ? 'loading' : 'none';

  const xH = embedExtras.xOriginHandle;
  const xMentionAttributionHandle =
    xH != null && String(xH).trim() ? String(xH).trim().replace(/^@+/, '') : '';

  const { embeds, chartEmbedIndex } = buildTraderScanEmbeds(
    {
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
      isNewMilestone: false,
      ...(xMentionAttributionHandle ? { xMentionAttributionHandle } : {})
    },
    {
      showTrackedMeta: true,
      chartPhase,
      layout: embedExtras.layout
    }
  );

  const pro = embedExtras?.proCall || null;
  const proLines = [];
  if (pro && (pro.title || pro.why || pro.risk || pro.tweetUrl)) {
    proLines.push('🧠 **Trusted Pro Call**');
    proLines.push('');

    if (pro.title) {
      proLines.push('**Thesis**');
      proLines.push(String(pro.title).trim());
      proLines.push('');
    }

    if (pro.why) {
      proLines.push('**Why**');
      proLines.push(String(pro.why).trim());
      proLines.push('');
    }

    if (pro.risk) {
      proLines.push('**Risk**');
      proLines.push(String(pro.risk).trim());
      proLines.push('');
    }

    const source = pro.tweetUrl ? String(pro.tweetUrl).trim() : pro.sourceLabel ? String(pro.sourceLabel).trim() : '';
    if (source) {
      proLines.push('**Source**');
      proLines.push(source);
      proLines.push('');
    }
  }

  const content =
    (proLines.length ? `${proLines.join('\n')}\n` : '') +
    '📍 Coin officially called and now being tracked.';

  return {
    content,
    embeds,
    chartEmbedIndex
  };
}

/**
 * Optionally attach QuickChart PNG for brand-new `user_call` rows only (same gate + fetch as X milestone charts).
 * @returns {Promise<{ content: string, embeds: unknown[], files?: import('discord.js').AttachmentBuilder[] }>}
 */
function applyChartBufferToPayload(payload, buf) {
  if (!payload || !buf || buf.length < 24) return payload;

  const attachmentName = 'call-chart.png';
  const attachment = new AttachmentBuilder(buf, { name: attachmentName });
  const idx = Number.isInteger(payload.chartEmbedIndex) ? payload.chartEmbedIndex : 0;
  const embeds = Array.isArray(payload.embeds) ? [...payload.embeds] : [];

  if (embeds[idx] && typeof embeds[idx].setImage === 'function') {
    embeds[idx] = EmbedBuilder.from(embeds[idx]).setImage(`attachment://${attachmentName}`);
  }

  return { ...payload, files: [attachment], embeds };
}

async function augmentNewUserCallPayloadWithChart(
  payload,
  trackedCall,
  wasNewCall,
  wasReactivated
) {
  if (!payload || !trackedCall) return payload;
  if (!wasNewCall || wasReactivated || trackedCall.callSourceType !== 'user_call') {
    return payload;
  }
  if (!isMilestoneChartAttachmentEnabled()) return payload;

  const buf = await fetchTokenChartImageBuffer(trackedCall);
  if (!buf || buf.length < 24) return payload;

  return applyChartBufferToPayload(payload, buf);
}

async function runDeferredUserCallChartEdits(messages, ctx) {
  const { realData, scan, trackedCall, wasNewCall, wasReactivated, xOriginHandle, proCall } = ctx;

  const buildFinalPayload = () =>
    buildUserCallAnnouncementPayload(realData, scan, trackedCall, wasNewCall, wasReactivated, {
      chartPhase: 'none',
      ...(xOriginHandle != null && String(xOriginHandle).trim()
        ? { xOriginHandle }
        : {}),
      ...(proCall ? { proCall } : {})
    });

  const safeEdit = async (payload) => {
    for (const m of messages) {
      if (!m || typeof m.edit !== 'function') continue;
      try {
        await m.edit({
          content: payload.content,
          embeds: payload.embeds,
          ...(Array.isArray(payload.files) && payload.files.length ? { files: payload.files } : {})
        });
      } catch (err) {
        console.error('[ChartDefer] Message edit failed:', err.message);
      }
    }
  };

  try {
    const buf = await fetchTokenChartImageBuffer(trackedCall);
    if (buf && buf.length >= 24) {
      await safeEdit(applyChartBufferToPayload(buildFinalPayload(), buf));
    } else {
      await safeEdit(buildFinalPayload());
    }
  } catch (err) {
    console.error('[ChartDefer] Chart fetch failed:', err.message);
    await safeEdit(buildFinalPayload());
  }
}

/**
 * Post the same announcement as `!call` to #user-calls or #token-calls (new user calls only).
 * @param {import('discord.js').Guild|null} guild
 * @param {{ content: string, embeds: unknown[] }} payload
 * @param {{ returnMessage?: boolean }} [options]
 * @returns {Promise<{ posted: boolean, reason?: string, message?: import('discord.js').Message }>}
 */
async function announceNewUserCallInUserCallsChannel(guild, payload, options = {}) {
  if (!guild?.channels?.cache) {
    return { posted: false, reason: 'no_guild' };
  }

  const mirrorNames = ['user-calls', 'token-calls'];
  let ch = null;
  for (const name of mirrorNames) {
    ch = guild.channels.cache.find(
      c =>
        c &&
        typeof c.isTextBased === 'function' &&
        c.isTextBased() &&
        String(c.name || '').toLowerCase() === name
    );
    if (ch) break;
  }

  if (!ch) {
    console.warn(
      '[UserCalls] No #user-calls or #token-calls text channel in guild:',
      guild.name || guild.id
    );
    return { posted: false, reason: 'no_channel' };
  }

  try {
    const msg = await ch.send({
      content: payload.content,
      embeds: payload.embeds,
      ...(Array.isArray(payload.files) && payload.files.length ? { files: payload.files } : {}),
      allowedMentions: { parse: [] }
    });
    if (options.returnMessage) {
      return { posted: true, message: msg };
    }
    return { posted: true };
  } catch (err) {
    console.error('[UserCalls] Send failed:', err.message);
    return { posted: false, reason: err.message };
  }
}

async function handleCallCommand(message, contractAddress, source = 'command', extras = {}) {
  try {
    const uid = message?.author?.id ? String(message.author.id) : '';
    if (uid) {
      const level = getCallerTrustLevel(uid);
      console.log(`[CallerTrust] user=${uid} level=${level} source=discord_call`);
    }
  } catch (_) {}

  const realData = await runQuickCa(contractAddress);
  const scan = normalizeRealDataToScan(realData);

  const { trackedCall, wasNewCall, wasReactivated } = await applyTrackedCallState(
    contractAddress,
    message,
    scan.marketCap || 0,
    scan,
    { callSourceType: 'user_call' }
  );

  const needsDeferredChart =
    wasNewCall &&
    !wasReactivated &&
    trackedCall?.callSourceType === 'user_call' &&
    isMilestoneChartAttachmentEnabled();

  const embedExtras = {
    chartPhase: needsDeferredChart ? 'loading' : 'none',
    ...(extras && typeof extras === 'object' ? extras : {})
  };

  let payload = buildUserCallAnnouncementPayload(
    realData,
    scan,
    trackedCall,
    wasNewCall,
    wasReactivated,
    embedExtras
  );

  if (!needsDeferredChart) {
    payload = await augmentNewUserCallPayloadWithChart(payload, trackedCall, wasNewCall, wasReactivated);
  }

  const replyPayload = {
    content: payload.content,
    embeds: payload.embeds,
    ...(Array.isArray(payload.files) && payload.files.length ? { files: payload.files } : {})
  };

  const sentMessage = await message.reply(replyPayload);

  let mirrorMessage = null;
  if (wasNewCall && trackedCall?.callSourceType === 'user_call') {
    const mirrorResult = await announceNewUserCallInUserCallsChannel(message.guild, payload, {
      returnMessage: true
    });
    mirrorMessage = mirrorResult.message || null;
  }

  if (needsDeferredChart) {
    void runDeferredUserCallChartEdits([sentMessage, mirrorMessage].filter(Boolean), {
      realData,
      scan,
      trackedCall,
      wasNewCall,
      wasReactivated,
      ...(embedExtras?.xOriginHandle ? { xOriginHandle: embedExtras.xOriginHandle } : {}),
      ...(embedExtras?.proCall ? { proCall: embedExtras.proCall } : {})
    });
  }
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

  const { embeds } = buildTraderScanEmbeds(
    {
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
    },
    {
      showTrackedMeta: true
    }
  );

  return message.reply({
    content: '👀 Added to watchlist tracking (no caller credit).',
    embeds
  });
}

async function handleBasicCommands(message, options = {}) {
  if (message.author.bot) return false;

  const content = message.content.trim();
  const lowerContent = content.toLowerCase();

  const scanChannelNames = options.scanChannelNames || ['scanner', 'scanner-feed', 'calls', 'coin-calls'];
  const isScannerStyleChannel = scanChannelNames.includes(String(message.channel?.name || '').toLowerCase());

  if (lowerContent === '!ping') {
    await message.reply('Pong!');
    return true;
  }

  if (lowerContent === '!help' || lowerContent === '!commands') {
    const embed = createCommandsEmbed();
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
    const { embeds } = buildTraderScanEmbeds(scan, { showTrackedMeta: false });
    await message.reply({ embeds });
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
  handleWatchCommand,
  buildTraderScanEmbeds,
  buildUserCallAnnouncementPayload,
  augmentNewUserCallPayloadWithChart,
  applyChartBufferToPayload,
  runDeferredUserCallChartEdits,
  announceNewUserCallInUserCallsChannel,
  isLikelySolanaCA,
  applyTrackedCallState,
  resolveTrackedCallCallerContext,
  buildTrackedCallCallerContextFromDiscordMessage,
  runQuickCa,
  normalizeRealDataToScan
};