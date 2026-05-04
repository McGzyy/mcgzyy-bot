'use strict';

const { createPost } = require('./xPoster');
const {
  getCallerLeaderboardInTimeframe,
  getBestCallInTimeframe,
  getBestBotCallInTimeframe,
  getWeeklyUtcTerminalSnapshot
} = require('./callerStatsService');
const { xBrandKicker, fitTweet, fitTweetWholeLines, resolveXTweetMaxChars } = require('./buildXPostText');

const TWEET_MAX_CHARS = resolveXTweetMaxChars();

function formatCallOneLiner(call) {
  if (!call || !call.ticker) return null;
  const t = String(call.ticker || call.tokenName || '').trim() || '??';
  const x = Number(call.x) || 0;
  return `$${t} · ${x.toFixed(2)}×`;
}

function dashboardLinkLine() {
  const u = String(
    process.env.DASHBOARD_PUBLIC_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.MCBOT_DASHBOARD_URL ||
      ''
  ).trim();
  return u ? `Full boards · ${u.replace(/\/$/, '')}` : '';
}

/** Shorter footer for weekly stats (saves chars at 280). */
function shortDashboardLinkLine() {
  const u = String(
    process.env.DASHBOARD_PUBLIC_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.MCBOT_DASHBOARD_URL ||
      ''
  )
    .trim()
    .replace(/\/$/, '');
  return u ? `Boards · ${u}` : '';
}

/**
 * @param {{ windowLabel: string, days: number, topN?: number }} p
 */
function buildLeaderboardDigestBody(p) {
  const topN = Number(p.topN) > 0 ? Number(p.topN) : 4;
  const rows = getCallerLeaderboardInTimeframe(p.days, topN);
  const bestHuman = getBestCallInTimeframe(p.days);
  const bestBot = getBestBotCallInTimeframe(p.days);

  const lines = [
    xBrandKicker(),
    `◆ ${p.windowLabel}`,
    '────────',
    'Caller desk (avg ×)'
  ];

  if (rows.length) {
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      lines.push(
        `${i + 1}. ${r.username} · ${r.avgX.toFixed(2)}× · ${r.totalCalls} calls`
      );
    }
  } else {
    lines.push('— quiet window —');
  }

  lines.push('────────', 'Highlights');

  if (bestHuman) {
    const h = formatCallOneLiner(bestHuman);
    if (h) lines.push(`Best caller print · ${h}`);
  }
  if (bestBot) {
    const b = formatCallOneLiner(bestBot);
    if (b) lines.push(`Best auto call · ${b}`);
  }

  const dash = dashboardLinkLine();
  if (dash) {
    lines.push('────────', dash);
  }

  return fitTweet(lines.join('\n'), DEFAULT_MAX);
}

const UTC_MO = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
];

/** @param {Date} startInclusive @param {Date} endExclusive */
function formatCompletedUtcWeekRangeLabel(startInclusive, endExclusive) {
  const lastDay = new Date(endExclusive.getTime() - 86400000);
  const sm = UTC_MO[startInclusive.getUTCMonth()];
  const sd = startInclusive.getUTCDate();
  const em = UTC_MO[lastDay.getUTCMonth()];
  const ed = lastDay.getUTCDate();
  const y = startInclusive.getUTCFullYear();
  const y2 = lastDay.getUTCFullYear();
  if (y === y2 && startInclusive.getUTCMonth() === lastDay.getUTCMonth()) {
    return `${sm} ${sd}–${ed}, ${y} UTC`;
  }
  if (y === y2) {
    return `${sm} ${sd}–${em} ${ed}, ${y} UTC`;
  }
  return `${sm} ${sd}, ${y} – ${em} ${ed}, ${y2} UTC`;
}

/**
 * @param {string[]} lines
 * @param {string} title
 * @param {{ count: number, medianX: number|null, pctGe2: number|null, pctGe3: number|null }} s
 */
function appendWeeklyCohortSection(lines, title, s) {
  lines.push(title, '');
  if (!s.count) {
    lines.push('· No qualifying prints in this window.');
    lines.push('');
    return;
  }
  const med = s.medianX == null ? '—' : `${Number(s.medianX).toFixed(2)}×`;
  const p2 = s.pctGe2 == null ? '—' : `${Number(s.pctGe2).toFixed(1)}%`;
  const p3 = s.pctGe3 == null ? '—' : `${Number(s.pctGe3).toFixed(1)}%`;
  lines.push(`· Calls · ${s.count}`);
  lines.push(`· Median ATH × · ${med}`);
  lines.push(`· At or above 2× · ${p2}`);
  lines.push(`· At or above 3× · ${p3}`);
  lines.push('');
}

/**
 * Stats-only weekly X copy (previous completed UTC Mon–Sun). No tickers.
 * Layout uses long-form space when `X_TWEET_MAX_CHARS` is high (e.g. 25,000).
 * @param {object} snap from getWeeklyUtcTerminalSnapshot()
 */
function buildWeeklyStatsSnapshotBody(snap) {
  const range = formatCompletedUtcWeekRangeLabel(snap.startInclusive, snap.endExclusive);
  const lines = [
    xBrandKicker(),
    '',
    '◆ Weekly terminal snapshot',
    `Completed UTC week · ${range}`,
    '',
    '────────',
    '',
    'How this reads',
    '',
    '· ATH multiple = peak market cap ÷ market cap at first tracked print (entry).',
    '· User desk = community !call / attributed prints. Auto desk = scanner auto-calls.',
    '· Same filters as in-app leaderboards (valid range, not denied / excluded from stats).',
    '',
    '────────',
    ''
  ];

  if (!snap.totalPrints) {
    lines.push('No qualifying prints in this UTC week.', '');
  } else {
    lines.push('Volume', '');
    lines.push(`· User-attributed calls · ${snap.user.count}`);
    lines.push(`· Auto-scanned calls · ${snap.bot.count}`);
    lines.push(`· Combined · ${snap.totalPrints}`);
    lines.push('');
    lines.push('────────', '');
    appendWeeklyCohortSection(lines, 'User desk', snap.user);
    lines.push('────────', '');
    appendWeeklyCohortSection(lines, 'Auto desk', snap.bot);
    lines.push('────────', '');
    lines.push('Community', '');
    lines.push(`· Active distinct callers · ${snap.uniqueCallers}`);
    lines.push('');
  }

  const dash = dashboardLinkLine();
  if (dash) {
    lines.push('────────', '', dash, '');
  }

  const raw = lines.join('\n').trimEnd();
  return TWEET_MAX_CHARS >= 2000 ? fitTweet(raw, TWEET_MAX_CHARS) : fitTweetWholeLines(raw, TWEET_MAX_CHARS);
}

let lastDailyKey = '';
let lastWeeklyKey = '';
let lastWeeklyStatsKey = '';

async function postDigest(windowLabel, days, topN) {
  const text = buildLeaderboardDigestBody({ windowLabel, days, topN });
  const result = await createPost(text);
  if (!result.success) {
    console.error('[XLeaderboardDigest] post failed:', result.error || 'unknown');
  } else {
    console.log(`[XLeaderboardDigest] posted ${windowLabel} (${result.id || 'ok'})`);
  }
}

async function tickXLeaderboardDigest() {
  const enabled = String(process.env.X_LEADERBOARD_DIGEST_ENABLED || '')
    .trim()
    .toLowerCase();
  if (enabled !== '1' && enabled !== 'true' && enabled !== 'yes') {
    return;
  }

  const now = new Date();
  const utcDate = now.toISOString().slice(0, 10);
  const hour = now.getUTCHours();
  const minute = now.getUTCMinutes();
  const targetHour = Number(process.env.X_LEADERBOARD_DIGEST_UTC_HOUR ?? 16);
  if (hour !== targetHour || minute > 12) {
    return;
  }

  const dailyKey = `d:${utcDate}`;
  if (lastDailyKey !== dailyKey) {
    lastDailyKey = dailyKey;
    await postDigest('24h pulse', 1, 4);
  }

  const weeklyOn = String(process.env.X_LEADERBOARD_WEEKLY_DIGEST_ENABLED ?? 'true')
    .trim()
    .toLowerCase();
  const weeklyEnabled = weeklyOn !== '0' && weeklyOn !== 'false' && weeklyOn !== 'no';
  const wday = now.getUTCDay();
  const weeklyDay = Number(process.env.X_LEADERBOARD_WEEKLY_UTC_WEEKDAY ?? 1);
  if (weeklyEnabled && wday === weeklyDay) {
    const weekKey = `w:${utcDate}`;
    if (lastWeeklyKey !== weekKey) {
      lastWeeklyKey = weekKey;
      await postDigest('7d board', 7, 5);
    }
  }
}

async function tickWeeklyStatsSnapshot() {
  const enabled = String(process.env.X_WEEKLY_STATS_SNAPSHOT_ENABLED || '')
    .trim()
    .toLowerCase();
  if (enabled !== '1' && enabled !== 'true' && enabled !== 'yes') {
    return;
  }

  const now = new Date();
  const hour = now.getUTCHours();
  const minute = now.getUTCMinutes();
  const digestHour = Number(process.env.X_LEADERBOARD_DIGEST_UTC_HOUR ?? 16);
  const targetHour = Number(process.env.X_WEEKLY_STATS_UTC_HOUR ?? digestHour);
  if (hour !== targetHour || minute > 12) {
    return;
  }

  const wday = now.getUTCDay();
  const statsDay = Number(process.env.X_WEEKLY_STATS_UTC_WEEKDAY ?? 1);
  if (wday !== statsDay) {
    return;
  }

  const snap = getWeeklyUtcTerminalSnapshot(now);
  const key = `ws:${snap.startInclusive.toISOString().slice(0, 10)}`;
  if (lastWeeklyStatsKey === key) {
    return;
  }

  const text = buildWeeklyStatsSnapshotBody(snap);
  const result = await createPost(text);
  if (!result.success) {
    console.error('[XWeeklyStatsSnapshot] post failed:', result.error || 'unknown');
    return;
  }
  lastWeeklyStatsKey = key;
  console.log(`[XWeeklyStatsSnapshot] posted week ${key} (${result.id || 'ok'})`);
}

function startXLeaderboardDigestScheduler() {
  setInterval(() => {
    void tickXLeaderboardDigest();
    void tickWeeklyStatsSnapshot();
  }, 5 * 60 * 1000);
}

module.exports = {
  startXLeaderboardDigestScheduler,
  buildLeaderboardDigestBody,
  buildWeeklyStatsSnapshotBody,
  tickWeeklyStatsSnapshot
};
