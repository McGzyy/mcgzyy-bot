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
  fitTweet,
  fitTweetWholeLines,
  resolveXTweetMaxChars,
  resolveWeeklyStatsTweetMaxChars
} = require('./buildXPostText');

/** Light horizontal rule (Box Drawings) — reads cleanly on X mobile. */
const WEEKLY_RULE = '\u2500'.repeat(28);

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
  return u ? `Full boards — ${u.replace(/\/$/, '')}` : '';
}

function weeklySectionGap() {
  return `\n${WEEKLY_RULE}\n`;
}

/**
 * @param {{ count: number, medianX: number|null, pctGe2: number|null, pctGe3: number|null }} s
 */
function weeklyCohortBlock(title, subtitle, s) {
  const head = subtitle ? `${title}\n${subtitle}` : title;
  if (!s.count) {
    return `${head}\n\n(no qualifying prints in this window)`;
  }
  const med = s.medianX == null ? '—' : `${Number(s.medianX).toFixed(2)}×`;
  const p2 = s.pctGe2 == null ? '—' : `${Number(s.pctGe2).toFixed(1)}%`;
  const p3 = s.pctGe3 == null ? '—' : `${Number(s.pctGe3).toFixed(1)}%`;
  return [
    head,
    '',
    `• Calls — ${s.count}`,
    `• Median ATH × — ${med}`,
    `• Share at ≥ 2× — ${p2}`,
    `• Share at ≥ 3× — ${p3}`
  ].join('\n');
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
 * Stats + leaderboards for the previous completed UTC week (aligned with snapshot aggregates).
 * Plain-text layout tuned for X long-form and mobile "Show more".
 * @param {object} snap from getWeeklyUtcTerminalSnapshot()
 */
function buildWeeklyStatsSnapshotBody(snap) {
  const maxChars = resolveWeeklyStatsTweetMaxChars();
  const gap = weeklySectionGap();
  const { startInclusive, endExclusive } = snap;
  const range = formatCompletedUtcWeekRangeLabel(startInclusive, endExclusive);
  const callerTopN = Math.min(25, Math.max(5, Number(process.env.X_WEEKLY_SNAPSHOT_CALLER_TOP_N) || 15));
  const printTopN = Math.min(25, Math.max(5, Number(process.env.X_WEEKLY_SNAPSHOT_PRINT_TOP_N) || 12));

  const hero = [
    xBrandKicker(),
    '',
    `◆ Weekly snapshot — ${range}`,
    '',
    'Rolled-up performance for qualifying prints the terminal tracked this week (completed Mon–Sun, UTC).'
  ].join('\n');

  const sections = [hero];

  if (!snap.totalPrints) {
    sections.push('No qualifying prints landed in this UTC week window.');
  } else {
    sections.push(
      [
        'Summary',
        '',
        `• User-attributed prints — ${snap.user.count}`,
        `• Auto-scanned prints — ${snap.bot.count}`,
        `• Combined — ${snap.totalPrints}`,
        `• Active callers (distinct) — ${snap.uniqueCallers}`
      ].join('\n')
    );

    sections.push(
      weeklyCohortBlock(
        'User desk',
        'Community calls. ATH × compares peak market cap to the market cap at the first tracked print (entry).',
        snap.user
      )
    );

    sections.push(
      weeklyCohortBlock(
        'Auto desk',
        'Scanner auto-calls. Same ATH × definition as user desk.',
        snap.bot
      )
    );

    const desk = getCallerLeaderboardInUtcWeekBounds(startInclusive, endExclusive, callerTopN);
    const deskLines = [
      'Caller leaderboard',
      `Average ATH × across prints this week — top ${callerTopN} by average.`,
      ''
    ];
    if (desk.length) {
      for (let i = 0; i < desk.length; i += 1) {
        const r = desk[i];
        deskLines.push(
          `${i + 1}. ${r.username} — ${r.avgX.toFixed(2)}× avg — ${r.totalCalls} print${r.totalCalls === 1 ? '' : 's'}`
        );
      }
    } else {
      deskLines.push('(no qualifying rows)');
    }
    sections.push(deskLines.join('\n'));

    const topUser = getTopUserCallsInUtcWeekBounds(startInclusive, endExclusive, printTopN);
    const uLines = [
      'Standout user prints',
      `Highest ATH × vs entry — top ${printTopN} this week.`,
      ''
    ];
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
    const bLines = [
      'Standout auto prints',
      `Highest ATH × vs entry — top ${printTopN} this week.`,
      ''
    ];
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
        'Best of the week',
        '',
        `• Best user print — ${bestH ? formatCallOneLiner(bestH) || '—' : '—'}`,
        `• Best auto print — ${bestB ? formatCallOneLiner(bestB) || '—' : '—'}`
      ].join('\n')
    );

    sections.push(
      [
        'Notes',
        '',
        'Figures use the same validity filters as the in-app leaderboards (invalid extremes and excluded/denied flows omitted). Not financial advice.'
      ].join('\n')
    );
  }

  const dash = dashboardLinkLine();
  if (dash) {
    sections.push(dash);
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
