'use strict';

/**
 * Premium X (Twitter) copy for McGBot Terminal — milestones, approvals, and manual posts.
 * Attribution:
 * - McGBot calls: @McGBot
 * - Member calls: @handle when Supabase prefs allow tagging and multiple >= threshold; else generic credit
 */

/** Short section rule (narrow X clients avoid wrapping a long bar). */
const X_TERMINAL_SECTION_RULE = `${'\u2500'.repeat(4)} \u22C5 ${'\u2500'.repeat(4)}`;

function xTerminalSectionRule() {
  return X_TERMINAL_SECTION_RULE;
}

function xTerminalSectionGap() {
  return `\n${X_TERMINAL_SECTION_RULE}\n`;
}

function xTerminalFooterLine() {
  return '🔗 Dashboard + live boards — link in bio';
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
    return 'Credit · McGBot Terminal community';
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

  return 'Credit · McGBot Terminal community';
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
  const maxChars = Number(opts.maxChars) > 0 ? Number(opts.maxChars) : resolveXTweetMaxChars();
  const milestoneX = Number(opts.milestoneX) > 0 ? Number(opts.milestoneX) : 0;
  const isReply = opts.isReply === true;

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

  const headline =
    milestoneX > 0
      ? isReply
        ? `↳ ${milestoneX}× milestone`
        : `◆ ${milestoneX}× · first call`
      : '◆ Live call';

  const brand = 'McGBot Terminal';
  const sub =
    athX > 0
      ? `$${ticker} · ${athX.toFixed(2)}× ATH  ·  spot ${spotX.toFixed(2)}×`
      : `$${ticker} · ${spotX.toFixed(2)}×`;

  const rule = X_TERMINAL_SECTION_RULE;
  const lines = [
    `▲ ${brand}`,
    headline,
    rule,
    sub,
    rule,
    attribution,
    '',
    `Entry ${initialMcStr}  →  Peak ${athMcStr}`,
    '',
    'CA',
    `\`${ca}\``,
    '',
    `Chart · https://dexscreener.com/solana/${ca}`
  ];

  if (includeGmgnLink() && ca) {
    lines.push(`GMGN · https://gmgn.ai/sol/token/${ca}`);
  }

  const foot = xTerminalFooterLine();
  if (foot) {
    lines.push('', rule, '', foot);
  }

  let body = lines.join('\n');
  body = fitTweet(body, maxChars);

  return body;
}

/** Short line for leaderboard / system posts (same voice). */
function xBrandKicker() {
  return '▲ McGBot Terminal';
}

module.exports = {
  buildXPostText,
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
