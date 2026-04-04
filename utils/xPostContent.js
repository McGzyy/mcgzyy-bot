/**
 * Shared X milestone post copy — approval path (index) vs monitor auto-post path.
 * Keeps live posts and previews in sync with the two historical templates.
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

/** Same template as legacy index.js / mod-approval first post. */
function buildXPostTextApproval(trackedCall, milestoneX, isReply = false) {
  const ticker = trackedCall.ticker || 'UNKNOWN';
  const ca = trackedCall.contractAddress;
  const caller = resolveCallerApproval(trackedCall);
  const athMc = formatAthMc(trackedCall);

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

/** Same template as monitoringEngine auto-milestone posts. */
function buildXPostTextMonitor(trackedCall, milestoneX, isReply = false) {
  const tokenName = trackedCall.tokenName || 'Unknown Token';
  const ticker = trackedCall.ticker || 'UNKNOWN';
  const ca = trackedCall.contractAddress;
  const caller = resolveCallerMonitor(trackedCall, 'Unknown');
  const athMc = formatAthMc(trackedCall);

  if (!isReply) {
    return [
      `🚨 ${tokenName} ($${ticker}) just hit ${milestoneX}x from call`,
      ``,
      `👤 Called by: ${caller}`,
      `📈 ATH MC: ${athMc}`,
      `📍 CA: ${ca}`,
      ``,
      `#Solana #Crypto #Memecoin`
    ].join('\n');
  }

  return [
    `📈 UPDATE: ${tokenName} ($${ticker}) has now reached ${milestoneX}x`,
    ``,
    `👤 Original caller: ${caller}`,
    `📈 ATH MC: ${athMc}`,
    `📍 CA: ${ca}`,
    ``,
    `#Solana #Crypto #Memecoin`
  ].join('\n');
}

module.exports = {
  buildXPostTextApproval,
  buildXPostTextMonitor,
  resolveCallerApproval,
  resolveCallerMonitor,
  formatAthMc
};
