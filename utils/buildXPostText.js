'use strict';

const { formatDurationAgo } = require('./xCardRenderHelpers');
const { getXBotUsernameForCopy } = require('./xPoster');

/**
 * Premium X (Twitter) copy — milestones, approvals, and manual posts.
 * Milestones share the same long-form budget as digests (`resolveWeeklyStatsTweetMaxChars`).
 * Attribution:
 * - McGBot calls: @McGBot
 * - Member calls: @handle when Supabase prefs allow tagging and multiple >= threshold; else generic credit
 */

/** Soft section break — blank lines only (Unicode rules render as ugly underscores on X). */
function xTerminalSectionRule() {
  return '';
}

function xTerminalSectionGap() {
  return '\n\n';
}

function xTerminalFooterLine() {
  return '🔹 mcgbot.xyz · live calls · link in bio 🔹';
}

/** Hard ceiling for long-form X posts (raise via env if APIs change). */
function readXTweetCharHardCap() {
  const v = Number(String(process.env.X_TWEET_CHAR_HARD_CAP || '').trim().replace(/,/g, ''));
  if (Number.isFinite(v) && v >= 100) return v;
  return 25000;
}

/**
 * Parse env int (handles quotes, commas, spaces). Empty / invalid → fallback.
 * @param {string|undefined} name
 * @param {number} fallback
 */
function parseEnvTweetCharBudget(name, fallback) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const s = String(raw).trim().replace(/^['"]+|['"]+$/g, '').replace(/,/g, '');
  if (s === '') return fallback;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 100) return fallback;
  return n;
}

function resolveXTweetMaxChars() {
  const cap = readXTweetCharHardCap();
  const n = parseEnvTweetCharBudget('X_TWEET_MAX_CHARS', 280);
  return Math.min(cap, Math.max(100, n));
}

/**
 * Weekly stats snapshot can use `X_WEEKLY_STATS_MAX_CHARS` so a missing global
 * `X_TWEET_MAX_CHARS` on the bot host does not silently fall back to 280.
 *
 * Also enforces a **floor** (default 12_000) so `fitTweet` never chops this post
 * when ops env is wrong — long-form X still caps at `readXTweetCharHardCap()`.
 * Override floor with `X_WEEKLY_STATS_CHAR_FLOOR` (500 … cap).
 */
function resolveWeeklyStatsTweetMaxChars() {
  const cap = readXTweetCharHardCap();
  let base;
  if (process.env.X_WEEKLY_STATS_MAX_CHARS != null && String(process.env.X_WEEKLY_STATS_MAX_CHARS).trim() !== '') {
    const dedicated = parseEnvTweetCharBudget('X_WEEKLY_STATS_MAX_CHARS', 0);
    if (dedicated >= 280) {
      base = Math.min(cap, dedicated);
    } else {
      base = resolveXTweetMaxChars();
    }
  } else {
    base = resolveXTweetMaxChars();
  }

  const floorParsed = parseEnvTweetCharBudget('X_WEEKLY_STATS_CHAR_FLOOR', 0);
  const defaultFloor = 12000;
  const floor =
    floorParsed >= 500 && floorParsed <= cap ? floorParsed : Math.min(defaultFloor, cap);

  return Math.min(cap, Math.max(base, floor));
}


function formatUsd(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'N/A';
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1000) return `$${(num / 1000).toFixed(2)}k`;
  return `$${num.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function stripAt(handle) {
  return String(handle || '')
    .trim()
    .replace(/^@+/, '');
}

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

async function fetchUserXPostingPrefs(discordId) {
  if (!discordId || String(discordId).toUpperCase() === 'AUTO_BOT') return null;
  const supabase = getSupabaseForUserPrefs();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('users')
      .select(
        'x_handle, x_verified, x_milestone_tag_enabled, x_milestone_tag_min_multiple'
      )
      .eq('discord_id', String(discordId))
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

async function buildAttributionLine(trackedCall, multipleX) {
  if (!trackedCall) {
    return 'Credit · @McGBot';
  }

  if (trackedCall.callSourceType === 'bot_call') {
    return 'Credit · @McGBot (auto)';
  }

  const discordId = trackedCall.firstCallerDiscordId || trackedCall.firstCallerId;
  if (!discordId || String(discordId).toUpperCase() === 'AUTO_BOT') {
    return 'Credit · McGBot Community';
  }

  const prefs = await fetchUserXPostingPrefs(discordId);
  const verified = prefs && prefs.x_verified === true;
  const handle = stripAt(prefs?.x_handle);
  const enabled = prefs && prefs.x_milestone_tag_enabled === true;
  const minM = Number(prefs?.x_milestone_tag_min_multiple ?? 10);
  const mult = Number(multipleX) || 0;

  if (verified && handle && enabled && mult >= minM) {
    return `Credit · @${handle}`;
  }

  return 'Credit · McGBot Community';
}

function includeGmgnLink() {
  const raw = String(process.env.X_POST_INCLUDE_GMGN || '0').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * @param {string} text
 * @param {number} max
 */
function fitTweet(text, max) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  const marker = '\n…';
  const cut = max - marker.length;
  return `${s.slice(0, Math.max(0, cut)).trimEnd()}${marker}`;
}

/**
 * Prefer dropping whole lines over cutting mid-sentence (better for stats / digests).
 * @param {string} text
 * @param {number} max
 */
function fitTweetWholeLines(text, max) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  const marker = '\n…';
  const budget = max - marker.length;
  const lines = s.split('\n');
  let acc = '';
  for (const line of lines) {
    const next = acc ? `${acc}\n${line}` : line;
    if (next.length <= budget) {
      acc = next;
    } else {
      break;
    }
  }
  if (!acc && lines[0]) {
    const first = lines[0];
    if (first.length <= budget) {
      acc = first;
    } else {
      let cut = budget;
      while (cut > 24 && first[cut - 1] !== ' ') {
        cut -= 1;
      }
      acc = first.slice(0, cut).trimEnd();
    }
  }
  return `${acc}${marker}`;
}

/**
 * @param {object} trackedCall
 * @param {{ milestoneX?: number, isReply?: boolean, maxChars?: number }} [opts]
 */
async function buildXPostText(trackedCall, opts = {}) {
  const maxChars =
    Number(opts.maxChars) > 0 ? Number(opts.maxChars) : resolveWeeklyStatsTweetMaxChars();
  const milestoneX = Number(opts.milestoneX) > 0 ? Number(opts.milestoneX) : 0;
  const isReply = opts.isReply === true;
  const gap = xTerminalSectionGap();

  const ticker = (trackedCall.ticker || 'UNKNOWN').toUpperCase();
  const ca = trackedCall.contractAddress || '';
  const firstCalledMc = Number(trackedCall.firstCalledMarketCap || 0);
  const latestMc = Number(
    trackedCall.latestMarketCap ||
      trackedCall.firstCalledMarketCap ||
      0
  );
  const athVal = Number(
    trackedCall.ath ||
      trackedCall.athMc ||
      trackedCall.athMarketCap ||
      trackedCall.latestMarketCap ||
      trackedCall.firstCalledMarketCap ||
      0
  );

  const spotX =
    firstCalledMc > 0 ? Number((latestMc / firstCalledMc).toFixed(2)) : 0;
  const athX =
    firstCalledMc > 0 ? Number((athVal / firstCalledMc).toFixed(2)) : 0;
  const displayXForAttribution = athX > 0 ? athX : spotX;

  const initialMcStr = formatUsd(firstCalledMc);
  const athMcStr = formatUsd(athVal);

  const attribution = await buildAttributionLine(trackedCall, displayXForAttribution);

  const channelLabel =
    trackedCall?.callSourceType === 'bot_call' ? 'McGBot Calls' : 'Member Call';
  const milestoneLabel =
    milestoneX > 0
      ? isReply
        ? `${milestoneX}× milestone`
        : `${milestoneX}× since first call`
      : 'live call';

  const headerLine = `🔹 ${channelLabel} · ${milestoneLabel}`;

  const perfLine =
    athX > 0
      ? `$${ticker} · ${athX.toFixed(2)}× ATH · ${spotX.toFixed(2)}× spot`
      : `$${ticker} · ${spotX.toFixed(2)}×`;

  const detailLines = [attribution, `Entry ${initialMcStr} → Peak ${athMcStr}`];
  if (ca) {
    detailLines.push(ca);
    detailLines.push(`Chart https://dexscreener.com/solana/${ca}`);
    if (includeGmgnLink()) {
      detailLines.push(`GMGN https://gmgn.ai/sol/token/${ca}`);
    }
  }

  const foot = xTerminalFooterLine();
  const chunks = [headerLine, perfLine, detailLines.join('\n')];
  if (foot) {
    chunks.push(foot);
  }

  let body = chunks.filter(Boolean).join(gap).trim();
  body = maxChars >= 2000 ? fitTweet(body, maxChars) : fitTweetWholeLines(body, maxChars);

  return body;
}

function formatMilestoneXLabel(x) {
  const n = Number(x);
  if (!Number.isFinite(n) || n < 1.01) return '';
  const rounded = Math.round(n * 10) / 10;
  return rounded % 1 === 0 ? `${Math.round(rounded)}×` : `${rounded.toFixed(1)}×`;
}

function milestoneCaptionLegacyEnabled() {
  const raw = String(process.env.X_MILESTONE_CAPTION_LEGACY || '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * @param {string} attributionLine from buildAttributionLine
 * @returns {string|null} e.g. @handle
 */
function attributionToXTag(attributionLine) {
  const m = String(attributionLine || '').match(/@([A-Za-z0-9_]{1,15})/);
  return m ? `@${m[1]}` : null;
}

/** Blue diamond bookends for dashboard CTA (all channel types). */
function milestoneDashboardBioLine(_trackedCall) {
  const label = 'Dashboard link in bio';
  return `🔹 ${label} 🔹`;
}

/**
 * @param {object} trackedCall
 * @param {number} [multipleX]
 * @returns {Promise<string>} e.g. @McGzyy
 */
async function resolveMilestoneCallerXTag(trackedCall, multipleX = 0) {
  const testHandle = stripAt(trackedCall?.testForceCallerXHandle);
  if (testHandle) return `@${testHandle}`;

  if (trackedCall?.callSourceType === 'bot_call') {
    return `@${getXBotUsernameForCopy()}`;
  }

  const attribution = await buildAttributionLine(trackedCall, multipleX);
  return attributionToXTag(attribution) || 'Member';
}

/**
 * One-line caption for data-card X posts (stats and titles live on the image).
 * Override with `X_TERMINAL_CARD_CAPTION` in .env if needed.
 */
function buildMinimalTerminalCaption() {
  const custom = String(process.env.X_TERMINAL_CARD_CAPTION || '').trim();
  if (custom) return custom;
  return 'Tracked live - link in bio';
}

/**
 * Short caption for scheduled terminal digest cards (stats on image).
 * @param {'daily'|'weekly'|'monthly'|string} [_kind]
 * @param {string} [_windowLabel]
 */
function buildTerminalDigestCaption(_kind, _windowLabel = '') {
  return buildMinimalTerminalCaption();
}

/**
 * Short milestone caption (stats live on the card image).
 * @param {object} _trackedCall
 * @param {number} [_multipleX]
 */
async function buildMinimalXMilestoneCaption(_trackedCall, _multipleX = 0) {
  return buildMinimalTerminalCaption();
}

/**
 * Short X caption when stats live on the milestone data card image.
 * Reply milestones: empty caption (image-only once a reply card exists).
 * @param {object} trackedCall
 * @param {{ milestoneX?: number, isReply?: boolean, quotePreviousMilestone?: number, postRole?: 'anchor'|'update' }} [opts]
 */
async function buildXMilestoneCaption(trackedCall, opts = {}) {
  const milestoneX = Number(opts.milestoneX) > 0 ? Number(opts.milestoneX) : 0;
  const isReply = opts.isReply === true;

  if (isReply) {
    return '';
  }

  const ticker = String(trackedCall?.ticker || 'TOKEN')
    .trim()
    .replace(/^\$+/, '')
    .toUpperCase();

  const isBot = trackedCall?.callSourceType === 'bot_call';
  const isWatch = trackedCall?.callSourceType === 'watch_only';

  if (milestoneCaptionLegacyEnabled()) {
    const channel = isBot ? 'McGBot' : isWatch ? 'Watch' : 'Member call';
    const lines = [`${channel} · ${milestoneX}× · ${ticker}`];
    return appendMilestoneCaptionExtras(lines, trackedCall).join('\n').trim();
  }

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
  const spotX =
    firstCalledMc > 0 ? Number((latestMc / firstCalledMc).toFixed(2)) : 0;
  const athX =
    firstCalledMc > 0 ? Number((athVal / firstCalledMc).toFixed(2)) : 0;
  const displayX = athX > 0 ? athX : spotX > 0 ? spotX : milestoneX;

  return buildMinimalXMilestoneCaption(trackedCall, displayX);
}

/**
 * @param {string[]} lines
 * @param {object} trackedCall
 */
function appendMilestoneCaptionExtras(lines, trackedCall) {
  const out = [...lines];

  const includeBio = String(process.env.X_MILESTONE_CAPTION_INCLUDE_BIO_LINE ?? '1')
    .trim()
    .toLowerCase();
  if (includeBio !== '0' && includeBio !== 'false' && includeBio !== 'no') {
    out.push(milestoneDashboardBioLine(trackedCall));
  }

  const includeLink = String(process.env.X_MILESTONE_CAPTION_INCLUDE_LINK || '0')
    .trim()
    .toLowerCase();
  if (includeLink === '1' || includeLink === 'true' || includeLink === 'yes') {
    out.push('mcgbot.xyz');
  }

  const includeCa = String(process.env.X_MILESTONE_CAPTION_INCLUDE_CA || '')
    .trim()
    .toLowerCase();
  if (includeCa === '1' || includeCa === 'true' || includeCa === 'yes') {
    const ca = String(trackedCall?.contractAddress || '').trim();
    if (ca) {
      out.push(`https://dexscreener.com/solana/${ca}`);
    }
  }

  return out;
}

/** Short line for leaderboard / system posts (same voice). */
function xBrandKicker() {
  return '▲ McGBot Terminal';
}

module.exports = {
  buildXPostText,
  buildXMilestoneCaption,
  buildTerminalDigestCaption,
  buildMinimalTerminalCaption,
  buildAttributionLine,
  xBrandKicker,
  xTerminalSectionRule,
  xTerminalSectionGap,
  xTerminalFooterLine,
  fitTweet,
  fitTweetWholeLines,
  resolveXTweetMaxChars,
  resolveWeeklyStatsTweetMaxChars
};
