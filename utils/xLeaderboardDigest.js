'use strict';

const { createPost } = require('./xPoster');
const {
  getCallerLeaderboardInTimeframe,
  getBestCallInTimeframe,
  getBestBotCallInTimeframe,
  getWeeklyUtcTerminalSnapshot,
  getCallerLeaderboardInUtcWeekBounds,
  getBestCallInUtcWeekBounds,
  getBestBotCallInUtcWeekBounds,
  getTopUserCallsInUtcWeekBounds,
  getTopBotCallsInUtcWeekBounds
} = require('./callerStatsService');
const { xBrandKicker, fitTweet, fitTweetWholeLines, resolveXTweetMaxChars } = require('./buildXPostText');

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

/**
 * @param {{ windowLabel: string, days: number, topN?: number }} p
 */
function buildLeaderboardDigestBody(p) {
  const maxChars = resolveXTweetMaxChars();
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

  return fitTweet(lines.join('\n'), maxChars);
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
 * Stats + leaderboards for the previous completed UTC week (aligned with snapshot aggregates).
 * Resolves character limit at build time so `X_TWEET_MAX_CHARS` is never stale from module load.
 * @param {object} snap from getWeeklyUtcTerminalSnapshot()
 */
function buildWeeklyStatsSnapshotBody(snap) {
  const maxChars = resolveXTweetMaxChars();
  const { startInclusive, endExclusive } = snap;
  const range = formatCompletedUtcWeekRangeLabel(startInclusive, endExclusive);
  const callerTopN = Math.min(25, Math.max(5, Number(process.env.X_WEEKLY_SNAPSHOT_CALLER_TOP_N) || 15));
  const printTopN = Math.min(25, Math.max(5, Number(process.env.X_WEEKLY_SNAPSHOT_PRINT_TOP_N) || 12));

  const lines = [
    xBrandKicker(),
    '',
    '◆ Weekly terminal snapshot',
    `Completed UTC week · ${range}`,
    '',
    '────────',
    ''
  ];

  if (!snap.totalPrints) {
    lines.push('No qualifying prints in this UTC week.', '');
  } else {
    lines.push('Summary', '');
    lines.push(`· User-attributed calls · ${snap.user.count}`);
    lines.push(`· Auto-scanned calls · ${snap.bot.count}`);
    lines.push(`· Combined prints · ${snap.totalPrints}`);
    lines.push(`· Active distinct callers · ${snap.uniqueCallers}`);
    lines.push('');
    lines.push('────────', '');
    appendWeeklyCohortSection(lines, 'User desk — distribution', snap.user);
    lines.push('────────', '');
    appendWeeklyCohortSection(lines, 'Auto desk — distribution', snap.bot);
    lines.push('────────', '');

    const desk = getCallerLeaderboardInUtcWeekBounds(startInclusive, endExclusive, callerTopN);
    lines.push(`Caller desk — avg ATH × (top ${callerTopN} by average)`, '');
    if (desk.length) {
      for (let i = 0; i < desk.length; i += 1) {
        const r = desk[i];
        lines.push(`${i + 1}. ${r.username} · ${r.avgX.toFixed(2)}× avg · ${r.totalCalls} print${r.totalCalls === 1 ? '' : 's'}`);
      }
    } else {
      lines.push('· — no qualifying user desk rows —');
    }
    lines.push('');
    lines.push('────────', '');

    const topUser = getTopUserCallsInUtcWeekBounds(startInclusive, endExclusive, printTopN);
    lines.push(`Top user prints — ATH × vs entry (top ${printTopN})`, '');
    if (topUser.length) {
      for (let i = 0; i < topUser.length; i += 1) {
        const row = topUser[i];
        const one = formatCallOneLiner(row);
        lines.push(one ? `${i + 1}. ${one}` : `${i + 1}. (unknown)`);
      }
    } else {
      lines.push('· — none —');
    }
    lines.push('');
    lines.push('────────', '');

    const topBot = getTopBotCallsInUtcWeekBounds(startInclusive, endExclusive, printTopN);
    lines.push(`Top auto prints — ATH × vs entry (top ${printTopN})`, '');
    if (topBot.length) {
      for (let i = 0; i < topBot.length; i += 1) {
        const row = topBot[i];
        const one = formatCallOneLiner(row);
        lines.push(one ? `${i + 1}. ${one}` : `${i + 1}. (unknown)`);
      }
    } else {
      lines.push('· — none —');
    }
    lines.push('');
    lines.push('────────', '');

    const bestH = getBestCallInUtcWeekBounds(startInclusive, endExclusive);
    const bestB = getBestBotCallInUtcWeekBounds(startInclusive, endExclusive);
    lines.push('Week highs', '');
    if (bestH) {
      const h = formatCallOneLiner(bestH);
      if (h) lines.push(`· Best user print · ${h}`);
    } else {
      lines.push('· Best user print · —');
    }
    if (bestB) {
      const b = formatCallOneLiner(bestB);
      if (b) lines.push(`· Best auto print · ${b}`);
    } else {
      lines.push('· Best auto print · —');
    }
    lines.push('');
    lines.push('────────', '');
    lines.push(
      'Footnote · ATH × = peak MC ÷ entry MC at first tracked print. User desk = community calls; auto desk = scanner. Same validity filters as the dashboard leaderboards (not financial advice).',
      ''
    );
  }

  const dash = dashboardLinkLine();
  if (dash) {
    lines.push('────────', dash, '');
  }

  const raw = lines.join('\n').trimEnd();
  return maxChars >= 2000 ? fitTweet(raw, maxChars) : fitTweetWholeLines(raw, maxChars);
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
