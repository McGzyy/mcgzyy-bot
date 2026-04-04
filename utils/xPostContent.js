/**
 * Shared X milestone post copy — approval path (mod Approve) vs monitor auto-post path.
 * Same layout; footers differ slightly (brand vs light discovery).
 */

const {
  getPreferredPublicName,
  getUserProfileByDiscordId,
  resolvePublicCallerName
} = require('./userProfileService');

function formatUsd(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'N/A';
  return `$${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/** Keep credits single-line and bounded for X. */
function sanitizeCreditLine(label, raw) {
  const s = String(raw == null ? '' : raw)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const body = s.length ? s : '—';
  return `${label} · ${body.slice(0, 100)}`;
}

function resolveCallerApproval(trackedCall) {
  if (!trackedCall) return 'Unknown';

  return (
    getPreferredPublicName(
      getUserProfileByDiscordId(
        trackedCall.firstCallerDiscordId || trackedCall.firstCallerId || ''
      )
    ) ||
    trackedCall.firstCallerPublicName ||
    trackedCall.firstCallerDisplayName ||
    trackedCall.firstCallerUsername ||
    (trackedCall.callSourceType === 'bot_call'
      ? 'McGBot'
      : trackedCall.callSourceType === 'watch_only'
        ? 'No caller credit'
        : 'Unknown')
  );
}

function resolveCallerMonitor(trackedCall, fallback = 'Unknown') {
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

function formatAthMc(trackedCall) {
  return formatUsd(
    trackedCall.ath ||
      trackedCall.athMc ||
      trackedCall.athMarketCap ||
      trackedCall.latestMarketCap ||
      trackedCall.firstCalledMarketCap ||
      0
  );
}

function headlinePair(trackedCall) {
  const name = (trackedCall.tokenName || trackedCall.ticker || 'Token').trim() || 'Token';
  let ticker = String(trackedCall.ticker || 'UNKNOWN').trim();
  if (!ticker.startsWith('$')) {
    ticker = `$${ticker}`;
  }
  return { name, ticker };
}

/**
 * @param {'approval'|'monitor'} variant
 * @param {string} creditRaw — already resolved per path
 * @param {{ omitCallerOnReply?: boolean }} opts — approval replies stay compact (legacy)
 */
function buildMilestoneXBody(trackedCall, milestoneX, isReply, variant, creditRaw, opts = {}) {
  const { omitCallerOnReply = false } = opts;
  const { name, ticker } = headlinePair(trackedCall);
  const display = name.toUpperCase() === String(ticker).replace(/^\$/, '').toUpperCase()
    ? ticker
    : `${name} (${ticker})`;

  const athMc = formatAthMc(trackedCall);
  const ca = trackedCall.contractAddress;
  const creditLine = sanitizeCreditLine('Caller', creditRaw);

  const footer =
    variant === 'approval'
      ? 'Tracked · MCGZYY'
      : '#Solana · MCGZYY';

  if (!isReply) {
    return [
      `${display} · +${milestoneX}x from first call`,
      '',
      creditLine,
      `ATH MC · ${athMc}`,
      `CA · ${ca}`,
      '',
      footer
    ].join('\n');
  }

  const replyLines =
    omitCallerOnReply
      ? [
          `${display} · +${milestoneX}x update`,
          '',
          `ATH MC · ${athMc}`,
          `CA · see original post`,
          '',
          footer
        ]
      : [
          `${display} · +${milestoneX}x update`,
          '',
          creditLine,
          `ATH MC · ${athMc}`,
          `CA · see original post`,
          '',
          footer
        ];

  return replyLines.join('\n');
}

/** Mod-approval first post + replies (index.js). */
function buildXPostTextApproval(trackedCall, milestoneX, isReply = false) {
  const credit = resolveCallerApproval(trackedCall);
  return buildMilestoneXBody(trackedCall, milestoneX, isReply, 'approval', credit, {
    omitCallerOnReply: true
  });
}

/** Monitor loop milestone posts (user + bot calls once xApproved). */
function buildXPostTextMonitor(trackedCall, milestoneX, isReply = false) {
  const credit = resolveCallerMonitor(trackedCall, 'Unknown');
  return buildMilestoneXBody(trackedCall, milestoneX, isReply, 'monitor', credit);
}

module.exports = {
  buildXPostTextApproval,
  buildXPostTextMonitor,
  resolveCallerApproval,
  resolveCallerMonitor,
  formatAthMc
};
