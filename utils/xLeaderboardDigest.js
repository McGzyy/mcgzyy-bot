'use strict';

const path = require('path');
const { readJson, writeJson } = require('./jsonStore');
const { createPost, normalizePngUploadBuffer } = require('./xPoster');
const { loadXPostAuditEventsSince } = require('./xPostAudit');
const {
  buildWeeklyAvgXpDigestPng,
  buildPast30DaysDigestPng
} = require('./digestPerformanceChart');
const { buildWeeklySnapshotModulesPng } = require('./weeklySnapshotPanel');
const { buildDailyDigestCardPng } = require('./dailyDigestPanel');
const { tickXEngagementPosts } = require('./xEngagementScheduler');
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
  xTerminalSectionGap,
  xTerminalFooterLine,
  fitTweet,
  fitTweetWholeLines,
  resolveWeeklyStatsTweetMaxChars,
  buildTerminalDigestCaption
} = require('./buildXPostText');

/** Bullet for list rows — works on every X client (avoid emoji squares). */
const BUL = '\u2022 ';

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
    `${BUL}Calls — ${s.count}`,
    `${BUL}Median ATH × — ${med}`,
    `${BUL}Share at ≥ 2× — ${p2}`,
    `${BUL}Share at ≥ 3× — ${p3}`
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

  const rawLabel = String(p.windowLabel || '').trim();
  const head = `🚀 ${rawLabel}`;

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

  const hiLines = ['🔥 Highlights', ''];
  let anyHi = false;
  if (bestHuman) {
    const h = formatCallOneLiner(bestHuman);
    if (h) {
      hiLines.push(`${BUL}Best member call — ${h}`);
      anyHi = true;
    }
  }
  if (bestBot) {
    const b = formatCallOneLiner(bestBot);
    if (b) {
      hiLines.push(`${BUL}Best McGBot call — ${b}`);
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

  const hero = `🚀 Weekly snapshot — ${range}`;

  const sections = [hero];

  if (!snap.totalPrints) {
    sections.push('📭 No qualifying calls this week.');
  } else {
    sections.push(
      [
        '📊 Summary',
        '',
        `${BUL}Member calls — ${snap.user.count}`,
        `${BUL}McGBot calls — ${snap.bot.count}`,
        `${BUL}Combined calls — ${snap.totalPrints}`,
        `${BUL}Active callers (distinct) — ${snap.uniqueCallers}`
      ].join('\n')
    );

    sections.push(weeklyCohortBlock('🔺', 'Member desk', null, snap.user));

    sections.push(weeklyCohortBlock('🔻', 'McGBot desk', null, snap.bot));

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
        '🔥 Best of the week',
        '',
        `${BUL}Best member call — ${bestH ? formatCallOneLiner(bestH) || '—' : '—'}`,
        `${BUL}Best McGBot call — ${bestB ? formatCallOneLiner(bestB) || '—' : '—'}`
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

const digestStatePath = path.join(__dirname, '../data/xLeaderboardDigestState.json');

let lastDailyKey = '';
let lastWeeklyKey = '';
let lastMonthlyKey = '';
let lastWeeklyStatsKey = '';
let digestStateHydrated = false;

function envTruthy(name) {
  const v = String(process.env[name] || '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function envFalsy(name) {
  const v = String(process.env[name] || '')
    .trim()
    .toLowerCase();
  return v === '0' || v === 'false' || v === 'no';
}

function resolveDigestUtcHour() {
  const n = Number(process.env.X_LEADERBOARD_DIGEST_UTC_HOUR ?? 16);
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : 16;
}

function resolveDigestGraceHours() {
  const n = Number(process.env.X_LEADERBOARD_DIGEST_GRACE_HOURS ?? 2);
  if (!Number.isFinite(n) || n < 0) return 2;
  return Math.min(6, Math.floor(n));
}

/**
 * Posting window: target UTC hour plus optional grace hours (bot restart / tick drift).
 * Dedupe keys prevent double posts within the same calendar period.
 */
function isWithinDigestPostWindow(now, targetHour, graceHours) {
  const hour = now.getUTCHours();
  const end = Math.min(23, targetHour + graceHours);
  return hour >= targetHour && hour <= end;
}

async function hydrateDigestStateFromDisk() {
  if (digestStateHydrated) {
    return;
  }
  try {
    const j = await readJson(digestStatePath);
    if (j && typeof j === 'object') {
      lastDailyKey = String(j.lastDailyKey || '');
      lastWeeklyKey = String(j.lastWeeklyKey || '');
      lastMonthlyKey = String(j.lastMonthlyKey || '');
      lastWeeklyStatsKey = String(j.lastWeeklyStatsKey || '');
    }
  } catch {
    /* first run */
  }
  digestStateHydrated = true;
}

async function persistDigestState() {
  await writeJson(digestStatePath, {
    lastDailyKey,
    lastWeeklyKey,
    lastMonthlyKey,
    lastWeeklyStatsKey,
    updatedAt: new Date().toISOString()
  });
}

async function markDigestPosted(field, key) {
  if (field === 'daily') lastDailyKey = key;
  else if (field === 'weekly') lastWeeklyKey = key;
  else if (field === 'monthly') lastMonthlyKey = key;
  else if (field === 'weeklyStats') lastWeeklyStatsKey = key;
  await persistDigestState();
}

/**
 * @param {{ windowLabel: string, days: number, topN: number }} p
 * @param {{ attachDailyDualPanel?: boolean, attachDailyDigestCard?: boolean, attachWeeklyAvgXChart?: boolean, attachPast30DaysChart?: boolean, sampleData?: boolean }} [options]
 */
async function postDigest(p, options = {}) {
  const { windowLabel, days, topN } = p;
  /** Same attach path as milestone `createPost(text, null, chartBuf)` — upload inside `createPost`. */
  let png = null;

  const useTerminalDailyCard = options.attachDailyDualPanel || options.attachDailyDigestCard;

  if (useTerminalDailyCard) {
    try {
      const raw = await buildDailyDigestCardPng(new Date(), {
        sampleData: options.sampleData === true
      });
      png = normalizePngUploadBuffer(raw);
      if (!png) {
        console.error('[XLeaderboardDigest] daily digest card: render did not produce a valid PNG buffer');
      }
    } catch (err) {
      console.error('[XLeaderboardDigest] daily digest card failed:', err?.message || err);
    }
  } else if (options.attachWeeklyAvgXChart) {
    try {
      const raw = await buildWeeklyAvgXpDigestPng(new Date());
      png = normalizePngUploadBuffer(raw);
      if (!png) {
        console.error('[XLeaderboardDigest] weekly chart: render did not produce a valid PNG buffer');
      }
    } catch (err) {
      console.error('[XLeaderboardDigest] weekly avg× chart failed:', err?.message || err);
    }
  }

  if (options.attachPast30DaysChart) {
    try {
      const raw = await buildPast30DaysDigestPng(new Date(), 30);
      png = normalizePngUploadBuffer(raw);
      if (!png) {
        console.error('[XLeaderboardDigest] 30d trend chart: render did not produce a valid PNG buffer');
      }
    } catch (err) {
      console.error('[XLeaderboardDigest] 30d trend chart failed:', err?.message || err);
    }
  }

  let text;
  if (useTerminalDailyCard) {
    text = buildTerminalDigestCaption('daily', windowLabel);
  } else {
    text = buildLeaderboardDigestBody({ windowLabel, days, topN });
    const maxChars = resolveWeeklyStatsTweetMaxChars();
    if (text.length > maxChars) {
      text = maxChars >= 2000 ? fitTweet(text, maxChars) : fitTweetWholeLines(text, maxChars);
    }
  }

  const result = await createPost(text, null, png, { audit: { category: 'leaderboard_digest' } });
  if (!result.success) {
    console.error('[XLeaderboardDigest] post failed:', result.error || 'unknown');
  } else {
    console.log(
      `[XLeaderboardDigest] posted ${windowLabel} (${result.id || 'ok'}) media=${png ? 'yes' : 'no'} len=${text.length}`
    );
  }
  return { ...result, textLength: text.length };
}

async function tickXLeaderboardDigest() {
  await hydrateDigestStateFromDisk();

  if (!envTruthy('X_LEADERBOARD_DIGEST_ENABLED')) {
    return;
  }

  const now = new Date();
  const utcDate = now.toISOString().slice(0, 10);
  const targetHour = resolveDigestUtcHour();
  const graceHours = resolveDigestGraceHours();
  /**
   * Scheduler tick is `setInterval(...)` and may not align to :00.
   * Allow target hour + grace; dedupe by day/week/month keys prevents doubles.
   */
  if (!isWithinDigestPostWindow(now, targetHour, graceHours)) {
    return;
  }

  const dailyDigestOff = envFalsy('X_LEADERBOARD_DAILY_DIGEST_ENABLED');
  const dailyKey = `d:${utcDate}`;
  if (!dailyDigestOff && lastDailyKey !== dailyKey) {
    const result = await postDigest(
      { windowLabel: 'Daily snapshot', days: 1, topN: 4 },
      { attachDailyDualPanel: true }
    );
    if (result?.success) {
      await markDigestPosted('daily', dailyKey);
    }
  }

  const weeklyEnabled = !envFalsy('X_LEADERBOARD_WEEKLY_DIGEST_ENABLED');
  const wday = now.getUTCDay();
  const weeklyDay = Number(process.env.X_LEADERBOARD_WEEKLY_UTC_WEEKDAY ?? 1);
  if (weeklyEnabled && wday === weeklyDay) {
    const weekKey = `w:${utcDate}`;
    if (lastWeeklyKey !== weekKey) {
      const result = await postDigest(
        { windowLabel: '7d snapshot', days: 7, topN: 5 },
        { attachWeeklyAvgXChart: true }
      );
      if (result?.success) {
        await markDigestPosted('weekly', weekKey);
      }
    }
  }

  const monthlyDigestOff = envFalsy('X_LEADERBOARD_MONTHLY_DIGEST_ENABLED');
  if (!monthlyDigestOff && now.getUTCDate() === 1) {
    const mKey = `m:${utcDate.slice(0, 7)}`;
    if (lastMonthlyKey !== mKey) {
      const result = await postDigest(
        { windowLabel: 'Monthly snapshot', days: 30, topN: 8 },
        { attachPast30DaysChart: true }
      );
      if (result?.success) {
        await markDigestPosted('monthly', mKey);
      }
    }
  }
}

async function tickWeeklyStatsSnapshot() {
  await hydrateDigestStateFromDisk();

  if (!envTruthy('X_WEEKLY_STATS_SNAPSHOT_ENABLED')) {
    return;
  }

  const now = new Date();
  const digestHour = resolveDigestUtcHour();
  const targetHour = Number(process.env.X_WEEKLY_STATS_UTC_HOUR ?? digestHour);
  const graceHours = resolveDigestGraceHours();
  if (!isWithinDigestPostWindow(now, targetHour, graceHours)) {
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

  let png = null;
  try {
    const raw = await buildWeeklySnapshotModulesPng(now);
    png = normalizePngUploadBuffer(raw);
    if (!png) {
      console.error('[XWeeklyStatsSnapshot] panel image: invalid PNG buffer');
    }
  } catch (err) {
    console.error('[XWeeklyStatsSnapshot] panel image failed:', err?.message || err);
  }

  const result = await createPost(text, null, png, { audit: { category: 'weekly_terminal_snapshot' } });
  if (!result.success) {
    console.error('[XWeeklyStatsSnapshot] post failed:', result.error || 'unknown');
    return;
  }
  await markDigestPosted('weeklyStats', key);
  console.log(`[XWeeklyStatsSnapshot] posted week ${key} (${result.id || 'ok'})`);
}

const SCHEDULED_AUDIT_CATEGORIES = [
  'leaderboard_digest',
  'weekly_terminal_snapshot',
  'engagement_weekly_runner',
  'engagement_monthly_top_caller'
];

/**
 * Ops snapshot for Discord `!xdigeststatus` (owner diagnostics).
 */
async function getXDigestSchedulerStatus() {
  await hydrateDigestStateFromDisk();
  const now = new Date();
  const targetHour = resolveDigestUtcHour();
  const graceHours = resolveDigestGraceHours();
  const weeklyStatsHourRaw = process.env.X_WEEKLY_STATS_UTC_HOUR;
  const weeklyStatsHour =
    weeklyStatsHourRaw != null && String(weeklyStatsHourRaw).trim() !== ''
      ? Number(weeklyStatsHourRaw)
      : targetHour;

  const sinceMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const audit = await loadXPostAuditEventsSince(sinceMs);
  /** @type {Record<string, { ok: number, fail: number, lastOkTs: number|null, lastFailTs: number|null, lastError: string|null }>} */
  const auditByCat = {};
  for (const e of audit) {
    const cat = String(e.category || 'unknown');
    if (!SCHEDULED_AUDIT_CATEGORIES.includes(cat)) continue;
    if (!auditByCat[cat]) {
      auditByCat[cat] = { ok: 0, fail: 0, lastOkTs: null, lastFailTs: null, lastError: null };
    }
    const row = auditByCat[cat];
    const ts = Number(e.ts);
    if (e.success) {
      row.ok += 1;
      if (!row.lastOkTs || ts > row.lastOkTs) row.lastOkTs = ts;
    } else {
      row.fail += 1;
      if (!row.lastFailTs || ts > row.lastFailTs) row.lastFailTs = ts;
      row.lastError = e.errorSnippet || row.lastError;
    }
  }

  const xCredsOk = Boolean(
    process.env.X_API_KEY &&
      process.env.X_API_SECRET &&
      process.env.X_ACCESS_TOKEN &&
      process.env.X_ACCESS_TOKEN_SECRET
  );

  return {
    nowUtc: now.toISOString(),
    inDigestWindow: isWithinDigestPostWindow(now, targetHour, graceHours),
    targetHour,
    graceHours,
    digestEnabled: envTruthy('X_LEADERBOARD_DIGEST_ENABLED'),
    dailyDigestEnabled: envTruthy('X_LEADERBOARD_DIGEST_ENABLED') && !envFalsy('X_LEADERBOARD_DAILY_DIGEST_ENABLED'),
    weeklyDigestEnabled:
      envTruthy('X_LEADERBOARD_DIGEST_ENABLED') && !envFalsy('X_LEADERBOARD_WEEKLY_DIGEST_ENABLED'),
    monthlyDigestEnabled:
      envTruthy('X_LEADERBOARD_DIGEST_ENABLED') && !envFalsy('X_LEADERBOARD_MONTHLY_DIGEST_ENABLED'),
    weeklyStatsEnabled: envTruthy('X_WEEKLY_STATS_SNAPSHOT_ENABLED'),
    weeklyRunnerEnabled: envTruthy('X_WEEKLY_RUNNER_ENABLED'),
    monthlyTopCallerEnabled: envTruthy('X_MONTHLY_TOP_CALLER_ENABLED'),
    weeklyDigestWeekday: Number(process.env.X_LEADERBOARD_WEEKLY_UTC_WEEKDAY ?? 1),
    weeklyStatsWeekday: Number(process.env.X_WEEKLY_STATS_UTC_WEEKDAY ?? 1),
    weeklyRunnerWeekday: Number(process.env.X_WEEKLY_RUNNER_UTC_WEEKDAY ?? 2),
    weeklyStatsHour: Number.isFinite(weeklyStatsHour) ? weeklyStatsHour : targetHour,
    xCredsOk,
    persistedKeys: {
      lastDailyKey,
      lastWeeklyKey,
      lastMonthlyKey,
      lastWeeklyStatsKey
    },
    auditByCat
  };
}

function startXLeaderboardDigestScheduler() {
  const runTick = () => {
    void tickXLeaderboardDigest();
    void tickWeeklyStatsSnapshot();
    void tickXEngagementPosts();
  };

  void hydrateDigestStateFromDisk().then(() => {
    runTick();
  });

  setInterval(runTick, 5 * 60 * 1000);
}

/**
 * Post a leaderboard digest to X (same path as the scheduler). For Discord test commands.
 * @param {{ windowLabel: string, days: number, topN: number }} body
 * @param {{ attachDailyDualPanel?: boolean, attachWeeklyAvgXChart?: boolean, attachPast30DaysChart?: boolean }} [opts]
 */
async function postLeaderboardDigestToX(body, opts = {}) {
  return postDigest(body, opts);
}

module.exports = {
  startXLeaderboardDigestScheduler,
  buildLeaderboardDigestBody,
  buildWeeklyStatsSnapshotBody,
  tickWeeklyStatsSnapshot,
  postLeaderboardDigestToX,
  getXDigestSchedulerStatus
};
