const { buildDevLookupView } = require('./devLookupService');

function formatUsd(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 'N/A';
  return `$${num.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatX(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 'N/A';
  return `${num.toFixed(2)}x`;
}

function shortenWallet(wallet) {
  const w = String(wallet || '').trim();
  if (!w) return '—';
  if (w.length < 16) return w;
  return `${w.slice(0, 6)}…${w.slice(-6)}`;
}

function clip(s, max = 220) {
  const str = String(s || '').trim();
  if (!str) return '';
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

/**
 * Build compact “Known dev” block for call embeds.
 * @param {object} dev - tracked dev record
 * @param {{ matchedBy?: string }} [meta]
 * @returns {{ name: string, value: string }|null}
 */
function buildKnownDevField(dev, meta = {}) {
  const view = buildDevLookupView(dev);
  if (!view) return null;

  const { rankData, bestLaunch, displayAvgXTop5, displayAvgAthTop5 } = view;
  const matchedBy = meta.matchedBy || 'wallet';

  const idParts = [];
  if (dev.nickname) idParts.push(`**${dev.nickname}**`);
  idParts.push(`\`${shortenWallet(dev.walletAddress)}\``);
  if (dev.xHandle) idParts.push(`[@${dev.xHandle}](https://x.com/${dev.xHandle})`);

  const lines = [
    idParts.join(' · '),
    `**Match:** \`${matchedBy}\``,
    `**Launches:** **${rankData.launchCount}** · **Tier:** \`${rankData.tier}\` · **Score:** **${rankData.score}**/100`,
    rankData.launchCount > 0
      ? `**Best:** ${formatX(bestLaunch?.displayX)} · ATH ${formatUsd(bestLaunch?.displayAth)}`
      : null,
    rankData.launchCount > 0
      ? `**Avg top 5 (merged):** ${formatX(displayAvgXTop5)} · ${formatUsd(displayAvgAthTop5)}`
      : null,
    Array.isArray(dev.tags) && dev.tags.length
      ? `**Tags:** ${dev.tags.slice(0, 10).map((t) => `\`${t}\``).join(' ')}`
      : null,
    dev.note ? `**Note:** ${clip(dev.note, 240)}` : null
  ].filter(Boolean);

  return {
    name: '🧠 Known dev (curated)',
    value: lines.join('\n').slice(0, 1024)
  };
}

module.exports = {
  buildKnownDevField
};

