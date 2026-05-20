'use strict';

const { resolveScanThumbnailUrl } = require('./embedTokenThumbnail');
const { formatDurationAgo, formatCoinAge } = require('./xCardRenderHelpers');
const { buildAttributionLine } = require('./buildXPostText');
const { resolveMcGBotAvatarPath } = require('./xBrandAssets');
const { getXBotUsernameForCopy } = require('./xPoster');

function getSupabaseForUserPrefs() {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const url = process.env.SUPABASE_URL;
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
      process.env.SUPABASE_ANON_KEY?.trim();
    if (!url || !key) return null;
    return createClient(url, key);
  } catch {
    return null;
  }
}

function stripAt(handle) {
  return String(handle || '')
    .trim()
    .replace(/^@+/, '');
}

/**
 * @param {string|null|undefined} discordId
 */
async function fetchCallerProfile(discordId) {
  const did = String(discordId || '').trim();
  if (!did || did.toUpperCase() === 'AUTO_BOT') {
    return { displayName: '', avatarUrl: '', xHandle: '', xVerified: false };
  }
  const sb = getSupabaseForUserPrefs();
  if (!sb) return { displayName: '', avatarUrl: '', xHandle: '', xVerified: false };
  try {
    const { data } = await sb
      .from('users')
      .select('discord_display_name, discord_avatar_url, x_handle, x_verified')
      .eq('discord_id', did)
      .maybeSingle();
    if (!data) return { displayName: '', avatarUrl: '', xHandle: '', xVerified: false };
    return {
      displayName: String(data.discord_display_name || '').trim(),
      avatarUrl: String(data.discord_avatar_url || '').trim(),
      xHandle: stripAt(data.x_handle),
      xVerified: data.x_verified === true
    };
  } catch {
    return { displayName: '', avatarUrl: '', xHandle: '', xVerified: false };
  }
}

/**
 * @param {object} trackedCall
 * @returns {'bot'|'member'|'watch'}
 */
function resolveChannel(trackedCall) {
  const src = String(trackedCall?.callSourceType || '').toLowerCase();
  if (src === 'bot_call') return 'bot';
  if (src === 'watch_only') return 'watch';
  return 'member';
}

function resolveChannelLabel(channel) {
  if (channel === 'bot') return 'McGBot Call';
  if (channel === 'watch') return 'Watch';
  return 'Member Call';
}

/**
 * @param {object} trackedCall
 * @param {object|null|undefined} latestScan
 */
function resolvePairCreatedMs(trackedCall, latestScan) {
  const candidates = [
    latestScan?.pairCreatedAt,
    trackedCall?.pairCreatedAt,
    latestScan?.market?.pairCreatedAt
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) {
      return n < 1e12 ? n * 1000 : n;
    }
  }
  return null;
}

/**
 * @param {object} trackedCall
 * @param {{ milestoneX: number, latestScan?: object|null }} opts
 * @returns {Promise<object>}
 */
async function buildMilestoneCardPayload(trackedCall, opts = {}) {
  const milestoneX = Number(opts.milestoneX) || 0;
  const headlineOverride = Number(opts.headlineX) || 0;
  const latestScan = opts.latestScan && typeof opts.latestScan === 'object' ? opts.latestScan : null;
  const channel = resolveChannel(trackedCall);

  const ticker = String(trackedCall?.ticker || 'UNKNOWN')
    .trim()
    .replace(/^\$+/, '')
    .toUpperCase();
  const tokenName = String(trackedCall?.tokenName || ticker || 'Unknown').trim();

  const firstCalledMc = Number(trackedCall?.firstCalledMarketCap || 0);
  const latestMc = Number(
    trackedCall?.latestMarketCap || trackedCall?.firstCalledMarketCap || 0
  );
  const athVal = Number(
    trackedCall?.ath ||
      trackedCall?.athMc ||
      trackedCall?.athMarketCap ||
      trackedCall?.latestMarketCap ||
      trackedCall?.firstCalledMarketCap ||
      0
  );

  const spotX = firstCalledMc > 0 ? latestMc / firstCalledMc : 0;
  const athX = firstCalledMc > 0 ? athVal / firstCalledMc : 0;
  const displayX = athX > 0 ? athX : spotX;
  const roundedAthX = Math.round(athX * 10) / 10;
  const headlineMultiple =
    headlineOverride > 0
      ? headlineOverride
      : milestoneX > 0
        ? Math.max(milestoneX, roundedAthX)
        : Math.round(Math.max(athX, spotX) * 100) / 100;

  const scanForThumb = latestScan || {
    contractAddress: trackedCall?.contractAddress,
    tokenImageUrl: trackedCall?.tokenImageUrl,
    token: { imageUrl: trackedCall?.tokenImageUrl }
  };
  const tokenImageUrl = resolveScanThumbnailUrl(scanForThumb);

  const calledAtRaw =
    trackedCall?.firstCalledAt || trackedCall?.calledAt || trackedCall?.createdAt || null;
  const calledAtMs =
    calledAtRaw != null ? new Date(calledAtRaw).getTime() : null;

  const pairCreatedAtMs = resolvePairCreatedMs(trackedCall, latestScan);
  const ageMinutes = Number(latestScan?.ageMinutes ?? trackedCall?.ageMinutes);

  const discordId = trackedCall?.firstCallerDiscordId || trackedCall?.firstCallerId || null;
  const profile = await fetchCallerProfile(discordId);
  const testHandle = String(trackedCall?.testForceCallerXHandle || '').trim();

  let callerName =
    profile.displayName ||
    trackedCall?.firstCallerPublicName ||
    trackedCall?.firstCallerDisplayName ||
    trackedCall?.firstCallerUsername ||
    (channel === 'bot' ? 'McGBot' : 'Community');

  let callerAvatarUrl = profile.avatarUrl || null;
  let callerAvatarLocalPath = '';
  let callerXHandle =
    profile.xVerified && profile.xHandle ? profile.xHandle : '';

  if (channel === 'bot') {
    callerName = 'McGBot';
    callerXHandle = getXBotUsernameForCopy();
    const botAvatarPath = resolveMcGBotAvatarPath();
    if (botAvatarPath) {
      callerAvatarLocalPath = botAvatarPath;
      callerAvatarUrl = null;
    }
  } else if (testHandle) {
    callerName = String(trackedCall?.firstCallerDisplayName || 'McGzyy').trim() || 'McGzyy';
    callerXHandle = testHandle;
    if (trackedCall?.testForceCallerAvatarUrl) {
      callerAvatarUrl = String(trackedCall.testForceCallerAvatarUrl).trim();
    }
  }

  const attribution = await buildAttributionLine(trackedCall, displayX);

  return {
    milestoneX,
    channel,
    channelLabel: resolveChannelLabel(channel),
    ticker,
    tokenName,
    contractAddress: String(trackedCall?.contractAddress || '').trim(),
    callMc: firstCalledMc,
    peakMc: athVal,
    spotMc: latestMc,
    athMultiple: athX,
    spotMultiple: spotX,
    headlineMultiple,
    tokenImageUrl,
    callerName,
    callerAvatarUrl,
    callerAvatarLocalPath,
    callerXHandle,
    attribution,
    calledAgo: formatDurationAgo(calledAtMs) || '—',
    coinAge: formatCoinAge({
      pairCreatedAtMs,
      ageMinutes: Number.isFinite(ageMinutes) ? ageMinutes : null
    }),
    calledAtMs: Number.isFinite(calledAtMs) ? calledAtMs : null
  };
}

module.exports = {
  buildMilestoneCardPayload,
  resolveChannel
};
