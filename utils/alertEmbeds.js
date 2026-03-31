const { EmbedBuilder } = require('discord.js');

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

function formatAgeMinutes(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
  return `${Number(value)} min`;
}

function shortenWallet(wallet) {
  if (!wallet || wallet.length < 12) return formatValue(wallet, 'Unknown');
  return `${wallet.slice(0, 6)}...${wallet.slice(-6)}`;
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

function getOriginalCallerLabel(coin, fallback = 'Auto Bot') {
  const caller =
    coin?.firstCallerDisplayName ||
    coin?.firstCallerPublicName ||
    coin?.firstCallerUsername ||
    coin?.calledByName ||
    coin?.calledBy ||
    coin?.originalCaller ||
    fallback;

  return formatValue(caller, fallback);
}

function buildCoinHeader(name, ticker) {
  return `# ${formatValue(name, 'Unknown Token')} ($${formatValue(ticker, 'UNKNOWN')})`;
}

function createAutoCallEmbed(scan, profileName = 'balanced') {
  const quickTradeLinks = buildQuickTradeLinksLine(scan.contractAddress, scan.pairAddress);
  const socialLinks = buildSocialLinksLine(scan);
  const originalCaller = getOriginalCallerLabel(scan, 'Auto Bot');

  const isManual = String(profileName || '').toLowerCase() === 'manual';
  const callTypeLine = isManual ? '📌 **MANUAL CALL**' : '🚨 **AUTO CALL**';
  const alertLabel = scan.alertType || (isManual ? '👤 Manual Scan' : '📡 Auto Call');

  const descriptionParts = [
    buildCoinHeader(scan.tokenName, scan.ticker),
    '',
    `## ${formatUsd(scan.marketCap)} MC`,
    callTypeLine,
    `**${alertLabel}**`,
    '',
    `**Original Caller:** ${originalCaller}`,
    `**Profile:** ${getProfileLabel(profileName)}`,
    `**Momentum:** ${formatValue(scan.momentum)}`,
    `**Risk:** ${formatValue(scan.riskLevel)}`,
    `**Pressure:** ${formatValue(scan.tradePressure)}`
  ];

  const embed = new EmbedBuilder()
    .setColor(isManual ? 0x3b82f6 : 0x00cc99)
    .setTitle(' ')
    .setDescription(descriptionParts.join('\n'))
    .addFields(
      {
        name: '🧾 Contract Address',
        value: `\`${formatValue(scan.contractAddress, 'Unknown')}\``,
        inline: false
      },
      {
        name: '📊 Market Setup',
        value:
          `**Liquidity:** ${formatUsd(scan.liquidity)}\n` +
          `**Vol (5m):** ${formatUsd(scan.volume5m)}\n` +
          `**Vol (1h):** ${formatUsd(scan.volume1h)}\n` +
          `**Age:** ${formatAgeMinutes(scan.ageMinutes)}`,
        inline: true
      },
      {
        name: '📈 Trade Strength',
        value:
          `**Buy/Sell (5m):** ${formatValue(scan.buySellRatio5m, 'N/A')}\n` +
          `**Buy/Sell (1h):** ${formatValue(scan.buySellRatio1h, 'N/A')}\n` +
          `**Trade Quality:** ${formatValue(scan.tradeQuality, 'N/A')}\n` +
          `**Score:** ${formatValue(scan.entryScore, 'N/A')}/100`,
        inline: true
      }
    )
    .setFooter({ text: isManual ? 'Crypto Scanner Bot • Manual Call' : 'Crypto Scanner Bot • Auto Call' })
    .setTimestamp();

  if (quickTradeLinks) {
    embed.addFields({
      name: '🔗 Trade',
      value: quickTradeLinks,
      inline: false
    });
  }

  if (socialLinks) {
    embed.addFields({
      name: '🔗 Project Links',
      value: socialLinks,
      inline: false
    });
  }

  return embed;
}

function createMilestoneEmbed(coin, scan, milestoneKey, performancePercent) {
  const tokenName = getSafeCoinName(coin, scan);
  const ticker = getSafeTicker(coin, scan);
  const contractAddress = getSafeContractAddress(coin, scan);
  const pairAddress = getSafePairAddress(coin, scan);

  const firstCalledMc = getSafeFirstCalledMc(coin);
  const currentMc = getSafeLatestMc(coin, scan);
  const originalCaller = getOriginalCallerLabel(coin, 'Auto Bot');

  const quickTradeLinks = buildQuickTradeLinksLine(contractAddress, pairAddress);
  const socialLinks = buildSocialLinksLine(scan);

  const milestoneText = getMilestoneTitle(milestoneKey).toUpperCase();

  const descriptionParts = [
    buildCoinHeader(tokenName, ticker),
    '',
    `# 🔥 ${milestoneText} 🔥`,
    '',
    `## ${formatUsd(currentMc)} MC`,
    `🚀 **Milestone**`
  ];

  if (quickTradeLinks) descriptionParts.push('', quickTradeLinks);

  descriptionParts.push(
    '',
    `**Original Caller:** ${originalCaller}`,
    `**Since First Call:** ${formatPercent(performancePercent)}`
  );

  const embed = new EmbedBuilder()
    .setColor(0xffcc33)
    .setTitle(' ')
    .setDescription(descriptionParts.join('\n'))
    .addFields(
      {
        name: '🧾 Contract Address',
        value: `\`${formatValue(contractAddress, 'Unknown')}\``,
        inline: false
      },
      {
        name: '📈 Performance',
        value:
          `**First Called MC:** ${formatUsd(firstCalledMc)}\n` +
          `**Current MC:** ${formatUsd(currentMc)}\n` +
          `**Milestone:** ${formatValue(milestoneKey, 'N/A')}`,
        inline: true
      },
      {
        name: '📊 Current Setup',
        value:
          `**Liquidity:** ${formatUsd(scan?.liquidity)}\n` +
          `**Vol (5m):** ${formatUsd(scan?.volume5m)}\n` +
          `**Vol (1h):** ${formatUsd(scan?.volume1h)}\n` +
          `**Age:** ${formatAgeMinutes(scan?.ageMinutes)}`,
        inline: true
      }
    )
    .setFooter({ text: 'Crypto Scanner Bot • Milestone Alert' })
    .setTimestamp();

  if (socialLinks) {
    embed.addFields({
      name: '🔗 Project Links',
      value: socialLinks,
      inline: false
    });
  }

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

  const dumpText = getDumpTitle(dumpKey).toUpperCase();

  const descriptionParts = [
    buildCoinHeader(tokenName, ticker),
    '',
    `# 💀 ${dumpText} 💀`,
    '',
    `## ${formatUsd(currentMc)} MC`,
    `📉 **Dump Alert**`
  ];

  if (quickTradeLinks) descriptionParts.push('', quickTradeLinks);

  descriptionParts.push(
    '',
    `**Drawdown:** ${formatPercent(drawdownPercent)}`,
    `**Momentum:** ${formatValue(scan?.momentum)}`,
    `**Pressure:** ${formatValue(scan?.tradePressure)}`
  );

  const embed = new EmbedBuilder()
    .setColor(0xff4444)
    .setTitle(' ')
    .setDescription(descriptionParts.join('\n'))
    .addFields(
      {
        name: '🧾 Contract Address',
        value: `\`${formatValue(contractAddress, 'Unknown')}\``,
        inline: false
      },
      {
        name: '📉 Drawdown Stats',
        value:
          `**ATH MC:** ${formatUsd(athMc)}\n` +
          `**Current MC:** ${formatUsd(currentMc)}\n` +
          `**Drop Trigger:** ${formatValue(dumpKey, 'N/A')}`,
        inline: true
      },
      {
        name: '📊 Current Setup',
        value:
          `**Liquidity:** ${formatUsd(scan?.liquidity)}\n` +
          `**Vol (5m):** ${formatUsd(scan?.volume5m)}\n` +
          `**Vol (1h):** ${formatUsd(scan?.volume1h)}\n` +
          `**Age:** ${formatAgeMinutes(scan?.ageMinutes)}`,
        inline: true
      }
    )
    .setFooter({ text: 'Crypto Scanner Bot • Drawdown Alert' })
    .setTimestamp();

  if (socialLinks) {
    embed.addFields({
      name: '🔗 Project Links',
      value: socialLinks,
      inline: false
    });
  }

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
  rankData = null
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

  if (rankData && isTracked) {
    descriptionParts.push(
      '',
      `## 🏅 Dev Rank`,
      `**Tier:** ${formatValue(rankData.tier, 'Unranked')}`,
      `**Score:** ${formatValue(rankData.score, 0)}/100`,
      `**Avg ATH (Top 5):** ${formatUsd(rankData.avgAth)}`,
      `**Avg X (Top 5):** ${formatX(rankData.avgX)}`,
      `**Tracked Launches:** ${formatValue(rankData.launchCount, 0)}`
    );
  }

  if (Array.isArray(trackedDev?.previousLaunches) && trackedDev.previousLaunches.length > 0) {
    const topLaunches = trackedDev.previousLaunches
      .slice(0, 5)
      .map((launch, index) => {
        return `${index + 1}. **${formatValue(launch.tokenName, 'Unknown')}** ($${formatValue(launch.ticker, 'UNKNOWN')}) — ${formatX(launch.xFromCall)} • ATH ${formatUsd(launch.athMarketCap)}`;
      })
      .join('\n');

    descriptionParts.push('', `## 🏆 Previous Top Launches`, topLaunches);
  }

  if (isTracked) {
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
    .setFooter({ text: 'Crypto Scanner Bot • Dev Feed' })
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

  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(title)
    .setDescription(
      [
        `**Token:** ${formatValue(call.tokenName, 'Unknown Token')} ($${formatValue(call.ticker, 'UNKNOWN')})`,
        `**Caller:** ${formatValue(call.firstCallerUsername || call.callerName, 'Unknown')}`,
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
  createTopCallerTimeframeEmbed
};