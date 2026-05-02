const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { resolvePublicCallerName } = require('./userProfileService');
const { formatAgeMinutes } = require('./formatAgeMinutes');
const { applyScanThumbnailToEmbed } = require('./embedTokenThumbnail');
const { isLaunchMigrated } = require('./devRegistryService');

function formatUsd(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
  return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
  return `${Number(value).toFixed(1)}%`;
}

function formatValue(value, fallback = 'Unknown') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function formatAgo(isoOrDateLike) {
  if (!isoOrDateLike) return null;
  const ts = new Date(isoOrDateLike).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return null;

  const diffMs = Date.now() - ts;
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;

  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function shortenWallet(wallet) {
  if (!wallet || wallet.length < 12) return formatValue(wallet, 'Unknown');
  return `${wallet.slice(0, 6)}...${wallet.slice(-6)}`;
}

function shortenCa(ca) {
  const s = typeof ca === 'string' ? ca.trim() : String(ca || '').trim();
  if (!s) return 'Unknown';
  if (s.length <= 16) return s;
  return `${s.slice(0, 6)}…${s.slice(-6)}`;
}

function toStatusToken(scan, isManual) {
  if (isManual) return 'MANUAL';
  if (scan?.callSourceType === 'watch_only') return 'WATCH';
  if (scan?.callSourceType === 'bot_call') return 'AUTO';
  return 'CALL';
}

function buildStatusStrip(scan, { isManual = false, profileName = 'balanced' } = {}) {
  const bits = [];
  bits.push(toStatusToken(scan, isManual));

  const label = String(scan?.alertType || '').replace(/\*/g, '').trim();
  if (label) bits.push(label.toUpperCase());

  const momentum = String(scan?.momentum || '').trim();
  if (momentum) bits.push(`MOMENTUM ${momentum.toUpperCase()}`);

  const risk = String(scan?.riskLevel || '').trim();
  if (risk) bits.push(`RISK ${risk.toUpperCase()}`);

  const score = Number(scan?.entryScore);
  if (Number.isFinite(score) && score > 0) bits.push(`SCORE ${Math.round(score)}`);

  const profile = getProfileLabel(profileName);
  if (profile) bits.push(profile.toUpperCase());

  return bits.filter(Boolean).slice(0, 6).join('  •  ');
}

function formatX(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 'N/A';
  return `${num.toFixed(2)}x`;
}

function buildSocialLinksLine(scan) {
  const links = [];

  if (scan?.website) links.push(`[Website](${scan.website})`);
  if (scan?.twitter) links.push(`[X / Twitter](${scan.twitter})`);
  if (scan?.telegram) links.push(`[Telegram](${scan.telegram})`);

  return links.length ? links.join(' • ') : null;
}

function buildQuickTradeLinksLine(contractAddress, pairAddress = null) {
  if (!contractAddress) return null;

  const terminal = `https://trade.padre.gg/trade/solana/${contractAddress}`;
  const gmgn = `https://gmgn.ai/sol/token/${contractAddress}`;

  const links = [`[Terminal](${terminal})`];

  if (pairAddress) {
    const axiom = `https://axiom.trade/meme/${pairAddress}`;
    links.push(`[Axiom](${axiom})`);
  }

  links.push(`[GMGN](${gmgn})`);

  return links.join(' • ');
}

function dexscreenerTokenUrl(contractAddress) {
  if (!contractAddress) return null;
  return `https://dexscreener.com/solana/${contractAddress}`;
}

function buildEliteCallLinkButtons(scan) {
  const ca = typeof scan?.contractAddress === 'string' ? scan.contractAddress.trim() : '';
  if (!ca) return null;

  const buttons = [];
  const dex = dexscreenerTokenUrl(ca);
  if (dex) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Dex').setURL(dex));

  buttons.push(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Trade')
      .setURL(`https://trade.padre.gg/trade/solana/${ca}`)
  );
  buttons.push(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('GMGN')
      .setURL(`https://gmgn.ai/sol/token/${ca}`)
  );

  const socials = [
    { label: 'Website', url: scan?.website },
    { label: 'X', url: scan?.twitter },
    { label: 'Telegram', url: scan?.telegram }
  ]
    .map((x) => ({ label: x.label, url: typeof x.url === 'string' ? x.url.trim() : '' }))
    .filter((x) => x.url);

  for (const s of socials) {
    if (buttons.length >= 5) break;
    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(s.label).setURL(s.url));
  }

  if (buttons.length === 0) return null;
  return new ActionRowBuilder().addComponents(buttons.slice(0, 5));
}

function getProfileLabel(profileName = 'balanced') {
  const clean = String(profileName || 'balanced').toLowerCase();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function getMilestoneTitle(key) {
  const clean = String(key || '').trim();
  if (!clean) return 'Milestone Reached';
  return `${clean} Reached`;
}

function getDumpTitle(key) {
  const clean = String(key || '').trim();
  if (!clean) return 'Major Drawdown';
  return `${clean} From ATH`;
}

function getSafeCoinName(coin, scan) {
  return scan?.tokenName || coin?.tokenName || 'Unknown Token';
}

function getSafeTicker(coin, scan) {
  return scan?.ticker || coin?.ticker || 'UNKNOWN';
}

function getSafeContractAddress(coin, scan) {
  return scan?.contractAddress || coin?.contractAddress || null;
}

function getSafePairAddress(coin, scan) {
  return scan?.pairAddress || coin?.pairAddress || null;
}

function getSafeFirstCalledMc(coin) {
  return Number(coin?.firstCalledMarketCap || 0);
}

function getSafeLatestMc(coin, scan) {
  return Number(scan?.marketCap ?? coin?.latestMarketCap ?? 0);
}

function getSafeAth(coin, scan) {
  return Number(
    coin?.ath ??
    coin?.athMc ??
    scan?.ath ??
    coin?.latestMarketCap ??
    scan?.marketCap ??
    0
  );
}

/**
 * Shallow-merge tracked call + latest scan so thumbnail resolution sees CA, pair, and token/image fields.
 * @param {object|null|undefined} coin
 * @param {object|null|undefined} scan
 * @returns {Record<string, unknown>}
 */
function mergeCoinAndScanForThumbnail(coin, scan) {
  const base = {};
  if (coin && typeof coin === 'object') Object.assign(base, coin);
  if (scan && typeof scan === 'object') Object.assign(base, scan);
  if (scan?.token && typeof scan.token === 'object') {
    base.token = scan.token;
  } else if (!base.token && coin?.token && typeof coin.token === 'object') {
    base.token = coin.token;
  }
  const ca =
    (typeof base.contractAddress === 'string' && base.contractAddress.trim()) ||
    (typeof coin?.contractAddress === 'string' && coin.contractAddress.trim()) ||
    '';
  if (ca) base.contractAddress = ca;
  return base;
}

/**
 * =========================
 * PUBLIC CALLER RESOLUTION
 * =========================
 */

function getOriginalCallerLabel(coin, fallback = 'Auto Bot') {
  if (!coin) return fallback;

  if (coin.callSourceType === 'bot_call') {
    return 'Auto Bot';
  }

  if (coin.callSourceType === 'watch_only') {
    return formatValue(
      coin?.firstCallerPublicName ||
      coin?.firstCallerDisplayName ||
      coin?.firstCallerUsername,
      fallback
    );
  }

  const resolved = resolvePublicCallerName({
    discordUserId: coin?.firstCallerDiscordId || coin?.firstCallerId || null,
    username: coin?.firstCallerUsername || coin?.calledByName || coin?.calledBy || '',
    displayName: coin?.firstCallerDisplayName || coin?.calledByName || '',
    trackedCall: coin,
    fallback:
      coin?.firstCallerPublicName ||
      coin?.firstCallerDisplayName ||
      coin?.firstCallerUsername ||
      coin?.calledByName ||
      coin?.calledBy ||
      coin?.originalCaller ||
      fallback
  });

  return formatValue(resolved, fallback);
}

function formatReasonList(reasons) {
  if (!reasons || reasons.length === 0) return '—';
  return reasons.map((reason) => `• ${reason}`).join('\n');
}

function holdersLine(scan) {
  const n = Number(scan?.holders);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `• Holders: ${n}`;
}

function createAutoCallEmbed(scan, profileName = 'balanced', options = {}) {
  const isManual = String(profileName || '').toLowerCase() === 'manual';
  const originalCaller = isManual
    ? getOriginalCallerLabel(scan, 'Auto Bot')
    : resolvePublicCallerName({
        trackedCall: { callSourceType: 'bot_call' },
        fallback: 'Anonymous'
      });
  const alertLabel = scan.alertType || (isManual ? 'Manual Scan' : 'Auto Call');

  const tokenNameUpper = formatValue(scan.tokenName, 'UNKNOWN TOKEN').toUpperCase();
  const tickerUpper = formatValue(scan.ticker, 'UNKNOWN').toUpperCase();

  const statusStrip = buildStatusStrip(scan, { isManual, profileName });

  const overviewLine = [
    `**MC** ${formatUsd(scan.marketCap)}`,
    `**Liq** ${formatUsd(scan.liquidity)}`,
    `**Vol 5m** ${formatUsd(scan.volume5m)}`,
    `**Age** ${formatAgeMinutes(scan.ageMinutes)}`
  ].join('  •  ');

  const ca = formatValue(scan.contractAddress, 'Unknown');
  const holdersText = (() => {
    const n = Number(scan?.holders);
    if (!Number.isFinite(n) || n <= 0) return '—';
    return n.toLocaleString('en-US');
  })();

  const embed = new EmbedBuilder()
    .setColor(isManual ? 0x3b82f6 : 0x10b981)
    .setTitle(`🚀 ${tokenNameUpper} • $${tickerUpper}`)
    .setDescription(
      [
        statusStrip ? `**${statusStrip}**` : null,
        `Caller: **${formatValue(originalCaller, 'Auto Bot')}**`,
        '',
        overviewLine,
        options.chartPending ? '_Chart warming up…_' : ''
      ]
        .filter(Boolean)
        .join('\n')
    )
    .addFields(
      {
        name: '🧠 Signal',
        value: [
          `Momentum: **${formatValue(scan.momentum, '—')}**`,
          `Risk: **${formatValue(scan.riskLevel, '—')}**`,
          `Pressure: **${formatValue(scan.tradePressure, '—')}**`,
          `Score: **${formatValue(scan.entryScore, '—')}**/100`
        ].join('\n'),
        inline: true
      },
      {
        name: '📊 Snapshot',
        value: [
          `5m B/S: **${formatValue(scan.buySellRatio5m, '—')}**`,
          `1h B/S: **${formatValue(scan.buySellRatio1h, '—')}**`,
          `Quality: **${formatValue(scan.tradeQuality, '—')}**`,
          `Holders: **${holdersText}**`
        ].join('\n'),
        inline: true
      },
      {
        name: '🎯 Verdict',
        value: [
          `Grade: **${formatValue(scan.grade, '—')}**`,
          `Status: **${formatValue(scan.status, '—')}**`,
          `Conviction: **${formatValue(scan.conviction, '—')}**`
        ].join('\n'),
        inline: false
      },
      {
        name: '🧾 Contract',
        value: `\`${shortenCa(ca)}\`\nFull: \`${ca}\``,
        inline: false
      }
    )
    .setFooter({ text: isManual ? 'McGBot • Manual call' : 'McGBot • Auto call' })
    .setTimestamp();

  applyScanThumbnailToEmbed(embed, scan);

  if (options.chartImageUrl) {
    embed.setImage(options.chartImageUrl);
  }

  const buttons = buildEliteCallLinkButtons(scan);
  if (buttons) {
    // Caller decides whether to pass components; expose on embed for compatibility.
    embed._eliteButtons = buttons;
  }

  return embed;
}

function createMilestoneEmbed(coin, scan, milestoneKey, performancePercent, realXFromCall = null) {
  const tokenName = getSafeCoinName(coin, scan);
  const ticker = getSafeTicker(coin, scan);
  const contractAddress = getSafeContractAddress(coin, scan);
  const pairAddress = getSafePairAddress(coin, scan);

  const firstCalledMc = getSafeFirstCalledMc(coin);
  const currentMc = getSafeLatestMc(coin, scan);
  const originalCaller = getOriginalCallerLabel(coin, 'Auto Bot');
  const alertedAgo = formatAgo(coin?.firstCalledAt || coin?.calledAt || coin?.createdAt || null);

  const quickTradeLinks = buildQuickTradeLinksLine(contractAddress, pairAddress);
  const socialLinks = buildSocialLinksLine(scan);

  const milestoneLabel = getMilestoneTitle(milestoneKey);
  const headlineParts = [`**${milestoneLabel}**`];
  if (realXFromCall != null && Number.isFinite(Number(realXFromCall))) {
    headlineParts.push(`${Number(realXFromCall).toFixed(2)}x from call`);
  }
  const headline = headlineParts.join(' · ');

  const metaLine = [
    `Caller **${originalCaller}**`,
    `Since first call **${formatPercent(performancePercent)}**`,
    alertedAgo ? `First call **${alertedAgo}** ago` : null
  ]
    .filter(Boolean)
    .join(' · ');

  const rangeLine = `From ${formatUsd(firstCalledMc)} → ${formatUsd(currentMc)}`;

  const marketLine = [
    `MC ${formatUsd(currentMc)}`,
    `Liq ${formatUsd(scan?.liquidity)}`,
    `5m ${formatUsd(scan?.volume5m)}`,
    `1h ${formatUsd(scan?.volume1h)}`,
    `Age ${formatAgeMinutes(scan?.ageMinutes)}`
  ].join(' · ');

  const descBody = [headline, rangeLine, metaLine, quickTradeLinks, marketLine].filter(Boolean).join('\n\n');
  const ca = formatValue(contractAddress, 'Unknown');
  const thumbnailPayload = mergeCoinAndScanForThumbnail(coin, scan);

  const embed = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(`${tokenName} (${ticker})`)
    .setDescription(descBody)
    .addFields({ name: 'Contract', value: `\`${ca}\``, inline: false })
    .setFooter({ text: 'McGBot · Milestone' })
    .setTimestamp();

  if (socialLinks) {
    embed.addFields({ name: 'Links', value: socialLinks, inline: false });
  }

  applyScanThumbnailToEmbed(embed, thumbnailPayload);

  const buttons = buildEliteCallLinkButtons(thumbnailPayload);
  if (buttons) embed._eliteButtons = buttons;

  return embed;
}

function createDumpEmbed(coin, scan, dumpKey, drawdownPercent) {
  const tokenName = getSafeCoinName(coin, scan);
  const ticker = getSafeTicker(coin, scan);
  const contractAddress = getSafeContractAddress(coin, scan);
  const pairAddress = getSafePairAddress(coin, scan);

  const currentMc = getSafeLatestMc(coin, scan);
  const athMc = getSafeAth(coin, scan);

  const quickTradeLinks = buildQuickTradeLinksLine(contractAddress, pairAddress);
  const socialLinks = buildSocialLinksLine(scan);

  const dumpLabel = getDumpTitle(dumpKey);
  const headline = `**${dumpLabel}**`;

  const statsLine = [
    `Trigger **${formatValue(dumpKey, '—')}**`,
    `From peak **${formatPercent(drawdownPercent)}**`,
    scan?.momentum ? `${formatValue(scan.momentum)} momentum` : null,
    scan?.tradePressure ? `${formatValue(scan.tradePressure)} pressure` : null
  ]
    .filter(Boolean)
    .join(' · ');

  const rangeLine = `ATH ${formatUsd(athMc)} → ${formatUsd(currentMc)}`;

  const marketLine = [
    `MC ${formatUsd(currentMc)}`,
    `Liq ${formatUsd(scan?.liquidity)}`,
    `5m ${formatUsd(scan?.volume5m)}`,
    `1h ${formatUsd(scan?.volume1h)}`,
    `Age ${formatAgeMinutes(scan?.ageMinutes)}`
  ].join(' · ');

  const descBody = [headline, statsLine, rangeLine, quickTradeLinks, marketLine].filter(Boolean).join('\n\n');
  const ca = formatValue(contractAddress, 'Unknown');
  const thumbnailPayload = mergeCoinAndScanForThumbnail(coin, scan);

  const embed = new EmbedBuilder()
    .setColor(0xdc2626)
    .setTitle(`${tokenName} (${ticker})`)
    .setDescription(descBody)
    .addFields({ name: 'Contract', value: `\`${ca}\``, inline: false })
    .setFooter({ text: 'McGBot · Drawdown' })
    .setTimestamp();

  if (socialLinks) {
    embed.addFields({ name: 'Links', value: socialLinks, inline: false });
  }

  applyScanThumbnailToEmbed(embed, thumbnailPayload);

  const buttons = buildEliteCallLinkButtons(thumbnailPayload);
  if (buttons) embed._eliteButtons = buttons;

  return embed;
}

function createDevAddedEmbed(dev) {
  const displayName = dev.nickname
    ? `${dev.nickname} (${shortenWallet(dev.walletAddress)})`
    : shortenWallet(dev.walletAddress);

  const descriptionParts = [
    `# 🧠 TRACKED DEV ADDED`,
    '',
    `**Dev:** ${displayName}`,
    `**Wallet:** \`${formatValue(dev.walletAddress, 'Unknown')}\``,
    `**Added By:** ${formatValue(dev.addedByUsername, 'Unknown')}`
  ];

  if (dev.note) {
    descriptionParts.push(`**Notes:** ${dev.note}`);
  }

  descriptionParts.push('', `📌 This wallet is now in your tracked dev registry.`);

  return new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle(' ')
    .setDescription(descriptionParts.join('\n'))
    .setFooter({ text: 'Crypto Scanner Bot • Dev Tracker' })
    .setTimestamp();
}

/**
 * @param {object|null} trackedDev
 * @param {number} limit
 * @returns {object[]}
 */
function getRecentDevLaunchesByTime(trackedDev, limit) {
  const n = Math.min(Math.max(1, Math.floor(Number(limit) || 3)), 3);
  const all = Array.isArray(trackedDev?.previousLaunches) ? [...trackedDev.previousLaunches] : [];
  return all
    .sort((a, b) => {
      const ta = new Date(a?.addedAt || 0).getTime();
      const tb = new Date(b?.addedAt || 0).getTime();
      if (tb !== ta) return tb - ta;
      return String(b?.contractAddress || '').localeCompare(String(a?.contractAddress || ''));
    })
    .slice(0, n);
}

/**
 * @param {object} launch
 * @returns {string}
 */
function formatRecentDevLaunchLine(launch) {
  const name = `**${formatValue(launch.tokenName, 'Unknown')}** ($${formatValue(launch.ticker, 'UNKNOWN')})`;
  const xStr = formatX(launch.xFromCall);
  const athStr = formatUsd(launch.athMarketCap);
  let stats;
  if (xStr !== 'N/A' && athStr !== 'N/A') {
    stats = `${xStr} • ATH ${athStr}`;
  } else if (xStr !== 'N/A') {
    stats = xStr;
  } else {
    stats = `ATH ${athStr}`;
  }
  const mig = isLaunchMigrated(launch) ? '✅ Migrated' : '⚪ Not migrated';
  return `${name} — ${stats} — ${mig}`;
}

function createDevLaunchAddedEmbed(dev, launch) {
  const displayName = dev?.nickname
    ? `${dev.nickname} (${shortenWallet(dev.walletAddress)})`
    : shortenWallet(dev?.walletAddress);

  const descriptionParts = [
    `# 🏆 DEV LAUNCH ADDED`,
    '',
    `**Dev:** ${displayName}`,
    `**Token:** ${formatValue(launch.tokenName, 'Unknown Token')} ($${formatValue(launch.ticker, 'UNKNOWN')})`,
    `**ATH MC:** ${formatUsd(launch.athMarketCap)}`,
    `**From Call:** ${formatX(launch.xFromCall)}`
  ];

  if (launch.contractAddress) {
    descriptionParts.push(`**CA:** \`${launch.contractAddress}\``);
  }

  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(' ')
    .setDescription(descriptionParts.join('\n'))
    .setFooter({ text: 'Crypto Scanner Bot • Dev History' })
    .setTimestamp();
}

function createDevCheckEmbed({
  walletAddress,
  trackedDev = null,
  checkedBy = 'Unknown',
  contextLabel = 'Dev Check',
  rankData = null,
  showDevEditMenu = true,
  compactCard = false
}) {
  const isTracked = !!trackedDev;

  const displayName = trackedDev?.nickname
    ? `${trackedDev.nickname} (${shortenWallet(walletAddress)})`
    : shortenWallet(walletAddress);

  const descriptionParts = [
    `# 🧠 ${formatValue(contextLabel, 'Dev Check').toUpperCase()}`,
    '',
    `**Dev:** ${displayName}`,
    `**Wallet:** \`${formatValue(walletAddress, 'Unknown')}\``,
    `**Checked By:** ${formatValue(checkedBy, 'Unknown')}`,
    '',
    `**Tracked Status:** ${isTracked ? '✅ Tracked' : '⚪ Not Tracked'}`
  ];

  if (trackedDev?.note) {
    descriptionParts.push(`**Registry Notes:** ${trackedDev.note}`);
  }

  const perf = rankData?.performance;
  if (rankData && isTracked && perf && perf.coinCount > 0) {
    const rateLine =
      perf.migrationRate != null && Number.isFinite(perf.migrationRate)
        ? formatPercent(perf.migrationRate * 100)
        : 'N/A';
    const riskLine = rankData.riskLabel || '—';
    descriptionParts.push(
      '',
      `## 📊 Performance (all coins)`,
      `**Risk:** ${riskLine}`,
      `**Avg ATH MC:** ${formatUsd(perf.avgAthMc)}`,
      `**Best ATH MC:** ${formatUsd(perf.bestAthMc)}`,
      `**Avg X:** ${formatX(perf.avgX)}`,
      `**Coins:** ${formatValue(perf.coinCount, 0)}`,
      `**Migration rate:** ${rateLine} (${formatValue(perf.migratedCount, 0)}/${formatValue(perf.coinCount, 0)})`
    );
  } else if (rankData && isTracked && perf && perf.coinCount === 0) {
    descriptionParts.push(
      '',
      `## 📊 Performance (all coins)`,
      `**Risk:** —`,
      `**Coins:** 0 — add launches to populate ATH, X, and migration stats.`
    );
  }

  if (rankData && isTracked && !compactCard) {
    descriptionParts.push(
      '',
      `## 🏅 Dev Rank`,
      `**Tier:** ${formatValue(rankData.tier, 'Unranked')}`,
      `**Score:** ${formatValue(rankData.score, 0)}/100`,
      `**Avg ATH (Top 5):** ${formatUsd(rankData.avgAth)}`,
      `**Avg X (Top 5):** ${formatX(rankData.avgX)}`,
      `**Tracked Launches:** ${formatValue(rankData.launchCount, 0)}`
    );
  } else if (rankData && isTracked && compactCard) {
    descriptionParts.push(
      '',
      `**Rank:** ${formatValue(rankData.tier, 'Unranked')} • Score ${formatValue(rankData.score, 0)}/100`
    );
  }

  if (Array.isArray(trackedDev?.previousLaunches) && trackedDev.previousLaunches.length > 0) {
    const recentLimit = compactCard ? 2 : 3;
    const recent = getRecentDevLaunchesByTime(trackedDev, recentLimit);
    if (recent.length) {
      const recentLines = recent
        .map((launch, index) => `${index + 1}. ${formatRecentDevLaunchLine(launch)}`)
        .join('\n');
      descriptionParts.push('', `## 🕐 Recent Launches`, recentLines);
    }

    const limit = compactCard ? 3 : 5;
    const topLaunches = trackedDev.previousLaunches
      .slice(0, limit)
      .map((launch, index) => {
        return `${index + 1}. **${formatValue(launch.tokenName, 'Unknown')}** ($${formatValue(launch.ticker, 'UNKNOWN')}) — ${formatX(launch.xFromCall)} • ATH ${formatUsd(launch.athMarketCap)}`;
      })
      .join('\n');

    descriptionParts.push('', `## 🏆 Previous Top Launches`, topLaunches);
  }

  if (isTracked && showDevEditMenu) {
    descriptionParts.push(
      '',
      `## ✏️ Edit Options`,
      `**Reply with:**`,
      `\`1\` Edit nickname`,
      `\`2\` Edit notes`,
      `\`3\` Add launch`,
      `\`4\` Remove launch`,
      `\`5\` Delete dev`,
      `\`6\` Cancel`
    );
  }

  descriptionParts.push('', `⚠️ Live wallet activity tracking is coming in Phase 2.`);

  return new EmbedBuilder()
    .setColor(isTracked ? 0x22c55e : 0x64748b)
    .setTitle(' ')
    .setDescription(descriptionParts.join('\n'))
    .setFooter({
      text: compactCard ? 'Crypto Scanner Bot • Dev Card' : 'Crypto Scanner Bot • Dev Feed'
    })
    .setTimestamp();
}

function createDevLeaderboardEmbed(devs = []) {
  const lines = devs.map((dev, index) => {
    const name = dev.nickname
      ? `${dev.nickname} (${shortenWallet(dev.walletAddress)})`
      : shortenWallet(dev.walletAddress);

    return `${index + 1}. **${name}** — ${dev.rankData.tier} • Score ${dev.rankData.score}/100 • Avg ATH ${formatUsd(dev.rankData.avgAth)}`;
  });

  return new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle('🏆 DEV LEADERBOARD')
    .setDescription(lines.length ? lines.join('\n\n') : 'No ranked devs yet.')
    .setFooter({ text: 'Crypto Scanner Bot • Dev Rankings' })
    .setTimestamp();
}

function createCallerCardEmbed(stats) {
  if (!stats) {
    return new EmbedBuilder()
      .setColor(0x64748b)
      .setTitle('👤 CALLER CARD')
      .setDescription('No caller data found for that user.')
      .setFooter({ text: 'Crypto Scanner Bot • Caller Stats' })
      .setTimestamp();
  }

  const bestCallLine = stats.bestCall
    ? `🏆 **Best Call:** ${stats.bestCall.tokenName} (${stats.bestCall.ticker}) — ${formatX(stats.bestCall.x)}`
    : '🏆 **Best Call:** N/A';

  const topCalls = Array.isArray(stats.topCalls) && stats.topCalls.length
    ? stats.topCalls
        .map((c, i) => `${i + 1}. **${formatValue(c.tokenName, 'Unknown')}** ($${formatValue(c.ticker, 'UNKNOWN')}) — ${formatX(c.x)} • ATH ${formatUsd(c.ath)}`)
        .join('\n')
    : 'No calls yet';

  return new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle(`👤 CALLER CARD — ${formatValue(stats.username, 'Unknown')}`)
    .setDescription(
      [
        `**Total Calls:** ${formatValue(stats.totalCalls, 0)}`,
        `**Average Call X:** ${formatX(stats.avgX)}`,
        `**Average ATH MC:** ${formatUsd(stats.avgAth)}`,
        '',
        bestCallLine,
        '',
        `## 🔥 Top Calls`,
        topCalls
      ].join('\n')
    )
    .setFooter({ text: 'Crypto Scanner Bot • Caller Stats' })
    .setTimestamp();
}

function createCallerLeaderboardEmbed(list = []) {
  const lines = list.map((c, i) => {
    return `${i + 1}. **${formatValue(c.username, 'Unknown')}** — Avg ${formatX(c.avgX)} • ${formatValue(c.totalCalls, 0)} calls • Avg ATH ${formatUsd(c.avgAth)}`;
  });

  return new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle('🏆 CALLER LEADERBOARD')
    .setDescription(lines.length ? lines.join('\n\n') : 'No caller data yet.')
    .setFooter({ text: 'Crypto Scanner Bot • Caller Rankings' })
    .setTimestamp();
}

function createSingleCallEmbed(call, title = '🏆 TOP CALL') {
  if (!call) {
    return new EmbedBuilder()
      .setColor(0x64748b)
      .setTitle(title)
      .setDescription('No data found for that timeframe.')
      .setFooter({ text: 'Crypto Scanner Bot • Timeframe Stats' })
      .setTimestamp();
  }

  const callerLabel = getOriginalCallerLabel(call, 'Unknown');

  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(title)
    .setDescription(
      [
        `**Token:** ${formatValue(call.tokenName, 'Unknown Token')} ($${formatValue(call.ticker, 'UNKNOWN')})`,
        `**Caller:** ${callerLabel}`,
        `**From Call:** ${formatX(call.x)}`,
        `**ATH MC:** ${formatUsd(call.ath)}`,
        `**First Called MC:** ${formatUsd(call.firstCalledMarketCap)}`,
        call.contractAddress ? `**CA:** \`${call.contractAddress}\`` : null
      ].filter(Boolean).join('\n')
    )
    .setFooter({ text: 'Crypto Scanner Bot • Timeframe Stats' })
    .setTimestamp();
}

function createTopCallerTimeframeEmbed(stats, title = '👤 TOP CALLER') {
  if (!stats) {
    return new EmbedBuilder()
      .setColor(0x64748b)
      .setTitle(title)
      .setDescription('No caller data found for that timeframe.')
      .setFooter({ text: 'Crypto Scanner Bot • Timeframe Stats' })
      .setTimestamp();
  }

  return new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle(title)
    .setDescription(
      [
        `**Caller:** ${formatValue(stats.username || stats.displayName, 'Unknown')}`,
        `**Total Calls:** ${formatValue(stats.totalCalls, 0)}`,
        `**Average Call X:** ${formatX(stats.avgX)}`,
        `**Average ATH MC:** ${formatUsd(stats.avgAth)}`,
        '',
        stats.bestCall
          ? `🏆 **Best Call:** ${formatValue(stats.bestCall.tokenName, 'Unknown')} ($${formatValue(stats.bestCall.ticker, 'UNKNOWN')}) — ${formatX(stats.bestCall.x)}`
          : '🏆 **Best Call:** N/A'
      ].join('\n')
    )
    .setFooter({ text: 'Crypto Scanner Bot • Timeframe Stats' })
    .setTimestamp();
}

/**
 * @param {{ inviteUrl: string, total: number, last24h: number, last7d: number, last30d: number }} p
 */
function createReferralCommandEmbed(p) {
  const total = Number(p.total) || 0;
  const last24h = Number(p.last24h) || 0;
  const last7d = Number(p.last7d) || 0;
  const last30d = Number(p.last30d) || 0;
  const url = String(p.inviteUrl || '').trim();

  const linkBlock = url
    ? url
    : 'Could not create a link. Set **REFERRAL_INVITE_CHANNEL_ID** (recommended) or add a **#verification** text channel, and ensure the bot can create invites there.';

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Your referrals')
    .setDescription(`**Your invite link**\n${linkBlock}`)
    .addFields(
      { name: 'Total referrals', value: `${total}`, inline: true },
      { name: 'Last 24 hours', value: `${last24h}`, inline: true },
      { name: 'Last 7 days', value: `${last7d}`, inline: true },
      { name: 'Last 30 days', value: `${last30d}`, inline: true }
    )
    .setFooter({ text: 'Crypto Scanner Bot • Only you see this summary' })
    .setTimestamp();
}

/**
 * @param {Array<{ username: string, count: number }>} entries
 */
function createReferralLeaderboardEmbed(entries = []) {
  const body =
    entries.length > 0
      ? entries
          .map((e, i) => {
            const name = formatValue(e.username, 'Unknown').slice(0, 80);
            const n = Number(e.count) || 0;
            return `${i + 1}. **${name}** — **${n}**`;
          })
          .join('\n')
      : 'No referrals recorded yet.';

  return new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle('Referral leaderboard')
    .setDescription(body)
    .setFooter({ text: 'Crypto Scanner Bot • Top 10 • Bots excluded' })
    .setTimestamp();
}

module.exports = {
  createAutoCallEmbed,
  createMilestoneEmbed,
  createDumpEmbed,
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
};