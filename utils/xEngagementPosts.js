'use strict';

const path = require('path');
const axios = require('axios');
const { readJson, writeJson } = require('./jsonStore');
const {
  getSupabaseServiceRole,
  getTopLeaderInCallTimeWindow,
  getBestCallRowInCallTimeWindow,
  previousUtcYearMonth,
  monthLabelUtc,
  periodKeyUtc,
  startOfWeekMondayUtcMs,
  startOfCalendarMonthUtcMs,
  rowAthMultiple
} = require('./callPerformanceLeaderboardNode');
const { createPost, normalizePngUploadBuffer } = require('./xPoster');
const { buildMilestoneHeroPng } = require('./milestoneHeroImage');
const { buildTopMonthlyCallerCardPng } = require('./topMonthlyCallerCard');
const {
  xTerminalSectionGap,
  xTerminalFooterLine,
  fitTweetWholeLines,
  fitTweet,
  resolveWeeklyStatsTweetMaxChars
} = require('./buildXPostText');
const { syncTopCallerDiscordRole } = require('./discordTopCallerRole');
const { awardMonthlyTopCallerIfNewPeriod } = require('./awardMonthlyTopCallerSupabase');

const statePath = path.join(__dirname, '../data/xEngagementState.json');

const BUL = '\u2022 ';

const TROPHY_LINES = {
  call_club_10x: '🎯 10× club',
  call_club_25x: '🚀 25× club',
  call_club_50x: '🌙 50× club'
};

async function readState() {
  try {
    const j = await readJson(statePath);
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

async function writeState(obj) {
  await writeJson(statePath, obj);
}

function resolveDashboardBaseUrl() {
  const raw =
    process.env.DASHBOARD_PUBLIC_URL ||
    process.env.MCBOT_DASHBOARD_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    '';
  return String(raw || '')
    .trim()
    .replace(/\/+$/, '');
}

/**
 * @param {string} discordId
 */
async function fetchUserExtrasFromSupabase(discordId) {
  const sb = getSupabaseServiceRole();
  if (!sb) {
    return { displayName: '', avatarUrl: '', x_handle: '', x_verified: false, trophies: [] };
  }
  const did = String(discordId || '').trim();
  let displayName = '';
  let avatarUrl = '';
  let x_handle = '';
  let x_verified = false;

  try {
    const { data: u } = await sb
      .from('users')
      .select('discord_display_name, discord_avatar_url, x_handle, x_verified')
      .eq('discord_id', did)
      .maybeSingle();
    if (u) {
      displayName = String(u.discord_display_name || '').trim();
      avatarUrl = String(u.discord_avatar_url || '').trim();
      x_handle = String(u.x_handle || '')
        .trim()
        .replace(/^@+/, '');
      x_verified = u.x_verified === true;
    }
  } catch {
    /* ignore */
  }

  /** @type {string[]} */
  const trophies = [];
  try {
    const { data: rows } = await sb
      .from('user_milestone_trophies')
      .select('milestone_key')
      .eq('user_id', did);
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const k = String(row.milestone_key || '').trim();
        if (!k) continue;
        trophies.push(TROPHY_LINES[k] || `🏅 ${k.replace(/_/g, ' ')}`);
      }
    }
  } catch {
    /* ignore */
  }

  return { displayName, avatarUrl, x_handle, x_verified, trophies };
}

/**
 * @param {{ avgX: number, totalCalls: number, wins: number, bestMultiple: number }} leader
 * @param {string} monthLabel
 * @param {string} _periodKey
 * @param {{ displayName: string, xTagLine: string, profileUrl: string, trophyLines: string[] }} ctx
 */
function buildMonthlyTopCallerBody(leader, monthLabel, _periodKey, ctx) {
  const gap = xTerminalSectionGap();
  const foot = xTerminalFooterLine();
  const maxChars = resolveWeeklyStatsTweetMaxChars();

  const head = `🔹 Top Caller · ${monthLabel} 🔹`;
  const spotlight = ctx.xTagLine;

  const statsLines = [
    `${BUL}Avg ATH × (month): **${leader.avgX.toFixed(2)}×**`,
    `${BUL}Calls (month): **${leader.totalCalls}**`,
    `${BUL}Wins at ≥2×: **${leader.wins}**`,
    `${BUL}Best single call: **${leader.bestMultiple.toFixed(2)}×**`
  ].join('\n');

  const congrats = [
    '**You carried the month.**',
    'McGBot Terminal · #1 member desk for this leaderboard period.',
    '',
    'Thank you for calling with the community — here’s to the next run.'
  ].join('\n');

  let trophyBlock = '';
  if (ctx.trophyLines.length) {
    trophyBlock = ['**Trophy shelf**', '', ...ctx.trophyLines.map(t => `${BUL}${t}`)].join('\n');
  }

  const linkLine = ctx.profileUrl
    ? `**Profile:** ${ctx.profileUrl}`
    : '**Profile:** Open the McGBot dashboard (sign in) to see your full call log.';

  const chunks = [head, spotlight, statsLines, congrats];
  if (trophyBlock) chunks.push(trophyBlock);
  chunks.push(linkLine);
  if (foot) chunks.push(foot);

  let body = chunks.filter(Boolean).join(gap).trim();
  body = maxChars >= 2000 ? fitTweet(body, maxChars) : fitTweetWholeLines(body, maxChars);
  return body;
}

/**
 * @param {Record<string, unknown>} row
 */
function buildWeeklyRunnerBody(row, weekLabel) {
  const gap = xTerminalSectionGap();
  const foot = xTerminalFooterLine();
  const maxChars = resolveWeeklyStatsTweetMaxChars();
  const mult = rowAthMultiple(row);
  const ticker = String(row.token_ticker || 'TOKEN')
    .trim()
    .toUpperCase()
    .replace(/^\$+/, '');
  const name = String(row.token_name || ticker).trim().slice(0, 80);
  const caller = String(row.username || '').trim() || 'Community';
  const ca = String(row.call_ca || '').trim();

  const head = '🔹 Weekly runner 🔹';
  const sub = `**${ticker}** ran **${mult.toFixed(2)}×** ATH this week (${weekLabel}).`;
  const credit = `Credit · **${caller}**`;
  const caBlock = ca ? ['CA', `\`${ca}\``].join('\n') : '';
  const chart = ca ? `Chart · https://dexscreener.com/solana/${ca}` : '';

  const chunks = [head, sub, credit];
  if (caBlock) chunks.push(caBlock);
  if (chart) chunks.push(chart);
  if (foot) chunks.push(foot);

  let body = chunks.filter(Boolean).join(gap).trim();
  body = maxChars >= 2000 ? fitTweet(body, maxChars) : fitTweetWholeLines(body, maxChars);
  return body;
}

function formatUtcWeekRangeLabel(weekStartMs, weekEndExclusiveMs) {
  const a = new Date(weekStartMs);
  const b = new Date(weekEndExclusiveMs - 86400000);
  const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  const y = a.getUTCFullYear();
  const y2 = b.getUTCFullYear();
  const left = a.toLocaleString('en-US', opts);
  const right = b.toLocaleString('en-US', opts);
  const yr = y === y2 ? String(y) : `${y}–${y2}`;
  return `${left} – ${right} ${yr} (UTC)`;
}

/**
 * @returns {Promise<{ success: boolean, id?: string|null, error?: unknown, skipped?: boolean }>}
 */
async function postWeeklyRunnerToX(opts = {}) {
  const force = !!opts.force;
  const enabled = ['1', 'true', 'yes'].includes(
    String(process.env.X_WEEKLY_RUNNER_ENABLED || '').trim().toLowerCase()
  );
  if (!enabled && !force) {
    return { success: false, skipped: true };
  }

  const sb = getSupabaseServiceRole();
  if (!sb) {
    console.error('[XWeeklyRunner] SUPABASE_SERVICE_ROLE_KEY missing');
    return { success: false, skipped: true };
  }

  const now = Date.now();
  const thisMon = startOfWeekMondayUtcMs(now);
  const priorWeekStart = startOfWeekMondayUtcMs(thisMon - 1);
  const priorWeekEnd = thisMon;

  const state = await readState();
  if (!force && Number(state.lastWeeklyRunnerWeekStartMs) === priorWeekStart) {
    return { success: false, skipped: true };
  }

  let row;
  try {
    row = await getBestCallRowInCallTimeWindow(sb, 'user', priorWeekStart, priorWeekEnd);
  } catch (e) {
    console.error('[XWeeklyRunner] query failed:', e?.message || e);
    return { success: false, error: e };
  }

  if (!row) {
    return { success: false, skipped: true };
  }

  const weekLabel = formatUtcWeekRangeLabel(priorWeekStart, priorWeekEnd);
  const text = buildWeeklyRunnerBody(row, weekLabel);
  const mult = Math.max(2, Math.round(rowAthMultiple(row)));
  const hero = await buildMilestoneHeroPng({
    milestoneX: mult,
    seedKey: String(row.call_ca || row.discord_id || 'runner'),
    callSourceType: 'user_call',
    ticker: String(row.token_ticker || '').trim() || 'RUN'
  }).catch(() => null);

  const png = hero ? normalizePngUploadBuffer(hero) : null;
  const result = await createPost(text, null, png || undefined, {
    audit: { category: 'engagement_weekly_runner', callSourceType: 'user_call' }
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  if (!force) {
    state.lastWeeklyRunnerWeekStartMs = priorWeekStart;
    await writeState(state);
  }
  console.log(`[XWeeklyRunner] posted ${result.id || 'ok'}`);
  return { success: true, id: result.id };
}

/**
 * @param {import('discord.js').Client | null} client
 * @param {{
 *   force?: boolean;
 *   forcePeriodKey?: string | null;
 *   skipDiscordRole?: boolean;
 *   skipSupabaseAward?: boolean;
 * }} [opts] test hooks (`skipSupabaseAward` avoids `user_badges` / `monthly_top_caller_awards`)
 */
async function postMonthlyTopCallerToX(client, opts = {}) {
  const force = !!opts.force;
  const enabled = ['1', 'true', 'yes'].includes(
    String(process.env.X_MONTHLY_TOP_CALLER_ENABLED || '').trim().toLowerCase()
  );
  if (!enabled && !force) {
    return { success: false, skipped: true };
  }

  const sb = getSupabaseServiceRole();
  if (!sb) {
    console.error('[XMonthlyTopCaller] SUPABASE_SERVICE_ROLE_KEY missing');
    return { success: false, skipped: true };
  }

  const anchor = new Date();
  const { y, m } = previousUtcYearMonth(anchor);
  const periodKey = periodKeyUtc(y, m);

  const state = await readState();
  if (!force && state.lastTopMonthlyPeriodKey === periodKey) {
    return { success: false, skipped: true };
  }

  const minMs = Date.UTC(y, m, 1, 0, 0, 0, 0);
  const maxEx = m === 11 ? Date.UTC(y + 1, 0, 1, 0, 0, 0, 0) : Date.UTC(y, m + 1, 1, 0, 0, 0, 0);

  let leader;
  try {
    leader = await getTopLeaderInCallTimeWindow(sb, 'user', minMs, maxEx);
  } catch (e) {
    console.error('[XMonthlyTopCaller] query failed:', e?.message || e);
    return { success: false, error: e };
  }

  if (!leader) {
    return { success: false, skipped: true };
  }

  const monthLabel = monthLabelUtc(y, m);
  const extras = await fetchUserExtrasFromSupabase(leader.discordId);
  const display =
    extras.displayName ||
    leader.username ||
    `Caller ${leader.discordId.slice(-4)}`;

  let xTagLine = `**Spotlight:** ${display}`;
  if (extras.x_verified && extras.x_handle) {
    xTagLine = `**Spotlight:** @${extras.x_handle.replace(/^@+/, '')}`;
  }

  const base = resolveDashboardBaseUrl();
  const profileUrl = base ? `${base}/user/${encodeURIComponent(leader.discordId)}` : '';

  const body = buildMonthlyTopCallerBody(leader, monthLabel, periodKey, {
    displayName: display,
    xTagLine,
    profileUrl,
    trophyLines: extras.trophies
  });

  let png = null;
  try {
    const raw = await buildTopMonthlyCallerCardPng({
      displayName: display,
      monthLabel,
      avgX: leader.avgX,
      totalCalls: leader.totalCalls,
      wins: leader.wins,
      bestMultiple: leader.bestMultiple,
      avatarUrl: extras.avatarUrl || null
    });
    png = normalizePngUploadBuffer(raw);
  } catch (e) {
    console.error('[XMonthlyTopCaller] card PNG:', e?.message || e);
  }

  const result = await createPost(body, null, png || undefined, {
    audit: { category: 'engagement_monthly_top_caller', callSourceType: 'user_call' }
  });
  if (!result.success) {
    return { success: false, error: result.error };
  }

  const prevHolder = state.lastTopCallerDiscordIdForRole || null;

  if (!opts.skipSupabaseAward) {
    const award = await awardMonthlyTopCallerIfNewPeriod(sb, minMs, leader.discordId, {
      previousDiscordId: prevHolder
    });
    if (!award.ok) {
      console.error('[XMonthlyTopCaller] Supabase top_caller award failed:', award.error);
    }
  }
  if (client && leader.discordId && !opts.skipDiscordRole) {
    await syncTopCallerDiscordRole(client, leader.discordId, {
      previousDiscordId: prevHolder
    });
  }

  if (!force) {
    state.lastTopMonthlyPeriodKey = periodKey;
  }
  if (!opts.skipDiscordRole) {
    state.lastTopCallerDiscordIdForRole = leader.discordId;
  }
  await writeState(state);

  console.log(`[XMonthlyTopCaller] posted ${result.id || 'ok'} period=${periodKey}`);
  return { success: true, id: result.id, periodKey };
}

module.exports = {
  postWeeklyRunnerToX,
  postMonthlyTopCallerToX,
  readState,
  writeState,
  resolveDashboardBaseUrl,
  buildMonthlyTopCallerBody,
  buildWeeklyRunnerBody
};
