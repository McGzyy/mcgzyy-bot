'use strict';

const { createPost } = require('./xPoster');
const {
  getCallerLeaderboardInTimeframe,
  getBestCallInTimeframe,
  getBestBotCallInTimeframe
} = require('./callerStatsService');
const { xBrandKicker, fitTweet } = require('./buildXPostText');

const DEFAULT_MAX = Math.min(4000, Math.max(100, Number(process.env.X_TWEET_MAX_CHARS || 280) || 280));

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

let lastDailyKey = '';
let lastWeeklyKey = '';

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

function startXLeaderboardDigestScheduler() {
  setInterval(() => {
    void tickXLeaderboardDigest();
  }, 5 * 60 * 1000);
}

module.exports = { startXLeaderboardDigestScheduler, buildLeaderboardDigestBody };
