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
const {
  xBrandKicker,
  xTerminalSectionGap,
  xTerminalFooterLine,
  fitTweet,
  fitTweetWholeLines,
  resolveWeeklyStatsTweetMaxChars
} = require('./buildXPostText');

/**
 * One-line print for X. No leading `$` on the ticker — X allows only **one** cashtag
 * ($SYMBOL) per post; weekly / digest lists would otherwise exceed that and get 403.
 */
function formatCallOneLiner(call) {
  if (!call || !call.ticker) return null;
  const raw = String(call.ticker || call.tokenName || '').trim().replace(/^\$+/u, '') || '??';
  const t = raw.length > 18 ? `${raw.slice(0, 16)}…` : raw;
  const x = Number(call.x) || 0;
  return `${t.toUpperCase()} · ${x.toFixed(2)}×`;
}

function weeklySectionGap() {
  return xTerminalSectionGap();
}

/**
 * @param {string} emoji single leading marker for the section
 * @param {string} title without emoji
 * @param {string} [subtitle]
 * @param {{ count: number, medianX: number|null, pctGe2: number|null, pctGe3: number|null }} s
 */
function weeklyCohortBlock(emoji, title, subtitle, s) {
  const head = subtitle ? `${emoji} ${title}\n${subtitle}` : `${emoji} ${title}`;
  if (!s.count) {
    return `${head}\n(no qualifying calls this week)`;
  }
  const med = s.medianX == null ? '—' : `${Number(s.medianX).toFixed(2)}×`;
  const p2 = s.pctGe2 == null ? '—' : `${Number(s.pctGe2).toFixed(1)}%`;
  const p3 = s.pctGe3 == null ? '—' : `${Number(s.pctGe3).toFixed(1)}%`;
  return [
    head,
    '',
    `▪ Calls — ${s.count}`,
    `▪ Median ATH × — ${med}`,
    `▪ Share at ≥ 2× — ${p2}`,
    `▪ Share at ≥ 3× — ${p3}`
  ].join('\n');
}

/**
 * @param {{ windowLabel: string, days: number, topN?: number }} p
 */
function buildLeaderboardDigestBody(p) {
  /** Same budget as weekly stats (`X_WEEKLY_STATS_*`, `X_TWEET_MAX_CHARS`) so digests are not stuck at 280. */
  const maxChars = resolveWeeklyStatsTweetMaxChars();
  const topN = Number(p.topN) > 0 ? Number(p.topN) : 4;
  const rows = getCallerLeaderboardInTimeframe(p.days, topN);
  const bestHuman = getBestCallInTimeframe(p.days);
  const bestBot = getBestBotCallInTimeframe(p.days);
  const gap = weeklySectionGap();
  const footer = xTerminalFooterLine();

  const head = [xBrandKicker(), `🚀 ${p.windowLabel}`].join('\n');

  const deskLines = [`💎 Caller leaderboard (top ${topN} by avg ATH ×)`, ''];
  if (rows.length) {
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      deskLines.push(
        `${i + 1}. ${r.username} — ${r.avgX.toFixed(2)}× avg — ${r.totalCalls} call${r.totalCalls === 1 ? '' : 's'}`
      );
    }
  } else {
    deskLines.push('(quiet window)');
  }

  const hiLines = ['⭐️ Highlights', ''];
  let anyHi = false;
  if (bestHuman) {
    const h = formatCallOneLiner(bestHuman);
    if (h) {
      hiLines.push(`▪ Best member call — ${h}`);
      anyHi = true;
    }
  }
  if (bestBot) {
    const b = formatCallOneLiner(bestBot);
    if (b) {
      hiLines.push(`▪ Best McGBot call — ${b}`);
      anyHi = true;
    }
  }
  if (!anyHi) {
    hiLines.push('(none)');
  }

  const chunks = [head, deskLines.join('\n'), hiLines.join('\n')];
  if (footer) {
    chunks.push(footer);
  }
  const raw = chunks.filter(Boolean).join(gap).trim();
  if (raw.length <= maxChars) {
    return raw;
  }
  return maxChars >= 2000 ? fitTweet(raw, maxChars) : fitTweetWholeLines(raw, maxChars);
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
    return `${sm} ${sd}–${ed}`;
  }
  if (y === y2) {
    return `${sm} ${sd}–${em} ${ed}`;
  }
  const yShort = String(y).slice(-2);
  const y2Short = String(y2).slice(-2);
  return `${sm} ${sd} '${yShort} – ${em} ${ed} '${y2Short}`;
}

/**
 * Stats + leaderboards for the previous completed UTC week (aligned with snapshot aggregates).
 * Plain-text layout tuned for X long-form and mobile "Show more".
 * @param {object} snap from getWeeklyUtcTerminalSnapshot()
 */
function buildWeeklyStatsSnapshotBody(snap) {
  const maxChars = resolveWeeklyStatsTweetMaxChars();
  const gap = weeklySectionGap();
  const { startInclusive, endExclusive } = snap;
  const range = formatCompletedUtcWeekRangeLabel(startInclusive, endExclusive);
  const callerTopN = Math.min(15, Math.max(3, Number(process.env.X_WEEKLY_SNAPSHOT_CALLER_TOP_N) || 8));
  const printTopN = Math.min(12, Math.max(3, Number(process.env.X_WEEKLY_SNAPSHOT_PRINT_TOP_N) || 6));

  const hero = [xBrandKicker(), `🚀 Weekly snapshot — ${range}`].join('\n');

  const sections = [hero];

  if (!snap.totalPrints) {
    sections.push('📭 No qualifying calls this week.');
  } else {
    sections.push(
      [
        '📊 Summary',
        '',
        `▪ Member calls — ${snap.user.count}`,
        `▪ McGBot calls — ${snap.bot.count}`,
        `▪ Combined calls — ${snap.totalPrints}`,
        `▪ Active callers (distinct) — ${snap.uniqueCallers}`
      ].join('\n')
    );

    sections.push(weeklyCohortBlock('🔺', 'Member desk', null, snap.user));

    sections.push(weeklyCohortBlock('◼️', 'McGBot desk', null, snap.bot));

    const desk = getCallerLeaderboardInUtcWeekBounds(startInclusive, endExclusive, callerTopN);
    const deskLines = [`💎 Caller leaderboard (top ${callerTopN} by avg ATH ×)`, ''];
    if (desk.length) {
      for (let i = 0; i < desk.length; i += 1) {
        const r = desk[i];
        deskLines.push(
          `${i + 1}. ${r.username} — ${r.avgX.toFixed(2)}× avg — ${r.totalCalls} call${r.totalCalls === 1 ? '' : 's'}`
        );
      }
    } else {
      deskLines.push('(no qualifying rows)');
    }
    sections.push(deskLines.join('\n'));

    const topUser = getTopUserCallsInUtcWeekBounds(startInclusive, endExclusive, printTopN);
    const uLines = [`📈 Top member calls (top ${printTopN} by ATH ×)`, ''];
    if (topUser.length) {
      for (let i = 0; i < topUser.length; i += 1) {
        const one = formatCallOneLiner(topUser[i]);
        uLines.push(`${i + 1}. ${one || '—'}`);
      }
    } else {
      uLines.push('(none)');
    }
    sections.push(uLines.join('\n'));

    const topBot = getTopBotCallsInUtcWeekBounds(startInclusive, endExclusive, printTopN);
    const bLines = [`⚡ Top McGBot calls (top ${printTopN} by ATH ×)`, ''];
    if (topBot.length) {
      for (let i = 0; i < topBot.length; i += 1) {
        const one = formatCallOneLiner(topBot[i]);
        bLines.push(`${i + 1}. ${one || '—'}`);
      }
    } else {
      bLines.push('(none)');
    }
    sections.push(bLines.join('\n'));

    const bestH = getBestCallInUtcWeekBounds(startInclusive, endExclusive);
    const bestB = getBestBotCallInUtcWeekBounds(startInclusive, endExclusive);
    sections.push(
      [
        '⭐️ Best of the week',
        '',
        `▪ Best member call — ${bestH ? formatCallOneLiner(bestH) || '—' : '—'}`,
        `▪ Best McGBot call — ${bestB ? formatCallOneLiner(bestB) || '—' : '—'}`
      ].join('\n')
    );
  }

  const foot = xTerminalFooterLine();
  if (foot) {
    sections.push(foot);
  }

  const raw = sections.filter(Boolean).join(gap).trim();
  if (raw.length <= maxChars) {
    return raw;
  }
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

  const dailyDigestOn = ['1', 'true', 'yes'].includes(
    String(process.env.X_LEADERBOARD_DAILY_DIGEST_ENABLED || '')
      .trim()
      .toLowerCase()
  );
  const dailyKey = `d:${utcDate}`;
  if (dailyDigestOn && lastDailyKey !== dailyKey) {
    lastDailyKey = dailyKey;
    await postDigest('Daily snapshot', 1, 4);
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
      await postDigest('7d snapshot', 7, 5);
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
  console.log(
    `[XWeeklyStatsSnapshot] bodyLen=${text.length} budget=${resolveWeeklyStatsTweetMaxChars()} week=${key}`
  );
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
