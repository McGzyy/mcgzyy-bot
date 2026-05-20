'use strict';

const { createCanvas } = require('canvas');
const {
  TEXT,
  MUTED,
  DIM,
  fitFontSize,
  channelAccent
} = require('./xCardRenderHelpers');
const {
  paintCardBackground,
  paintMgWatermark,
  drawSoftGlow,
  drawGradientNumber,
  CARD_WIDTH,
  CARD_HEIGHT
} = require('./xMilestoneDataCard');
const { loadMgMarkImage, loadMcGBotAvatarImage } = require('./xBrandAssets');
const { loadImage } = require('canvas');
const {
  getUtcYesterdayAndPriorDeskAvgs,
  getCallerLeaderboardInTimeframe,
  getBestCallInTimeframe,
  getBestBotCallInTimeframe,
  getPreviousCompletedUtcWeekBounds,
  getDeskAvgAthXPairForUtcRange,
  getCallerLeaderboardInUtcWeekBounds,
  getBestCallInUtcWeekBounds,
  getBestBotCallInUtcWeekBounds,
  startOfUtcCalendarDay
} = require('./callerStatsService');
const { buildWeeklyAvgXpDigestPng, buildPast30DaysDigestPng } = require('./digestPerformanceChart');

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

const W = CARD_WIDTH;
const H = CARD_HEIGHT;
const PAD = 52;
const MEMBER_AVG_GOOD_AT = 2;

function stripAt(handle) {
  return String(handle || '')
    .trim()
    .replace(/^@+/, '');
}

function getTestCallerHandle() {
  return stripAt(process.env.X_TEST_MILESTONE_CALLER_HANDLE || 'McGzyy') || 'McGzyy';
}

/**
 * @param {number|null|undefined} prev
 * @param {number|null|undefined} cur
 */
function fmtDayOverDay(prev, cur) {
  if (prev == null || cur == null || !Number.isFinite(prev) || !Number.isFinite(cur)) {
    return '—';
  }
  const d = cur - prev;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(2)}× vs prior day`;
}

/**
 * @param {number|null|undefined} prev
 * @param {number|null|undefined} cur
 */
function fmtWeekOverWeek(prev, cur) {
  if (prev == null || cur == null || !Number.isFinite(prev) || !Number.isFinite(cur)) {
    return '—';
  }
  const d = cur - prev;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(2)}× vs prior week`;
}

/**
 * @param {number|null|undefined} prev
 * @param {number|null|undefined} cur
 */
function fmt30dOverPrior30d(prev, cur) {
  if (prev == null || cur == null || !Number.isFinite(prev) || !Number.isFinite(cur)) {
    return '—';
  }
  const d = cur - prev;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(2)}× vs prior 30d`;
}

/** @param {Date} startInclusive @param {Date} endExclusive */
function formatUtcDateRangeLabel(startInclusive, endExclusive) {
  const lastDay = new Date(endExclusive.getTime() - 86400000);
  const sm = UTC_MO[startInclusive.getUTCMonth()];
  const sd = startInclusive.getUTCDate();
  const em = UTC_MO[lastDay.getUTCMonth()];
  const ed = lastDay.getUTCDate();
  const y = startInclusive.getUTCFullYear();
  const y2 = lastDay.getUTCFullYear();
  if (y === y2 && startInclusive.getUTCMonth() === lastDay.getUTCMonth()) {
    return `${sm} ${sd}–${ed}, ${y}`;
  }
  if (y === y2) {
    return `${sm} ${sd}–${em} ${ed}, ${y}`;
  }
  const yShort = String(y).slice(-2);
  const y2Short = String(y2).slice(-2);
  return `${sm} ${sd} '${yShort} – ${em} ${ed} '${y2Short}`;
}

/** @param {Date} [anchor] */
function getUtcRolling30AndPrior30Bounds(anchor = new Date()) {
  const endExclusive = startOfUtcCalendarDay(anchor);
  const curStart = new Date(endExclusive);
  curStart.setUTCDate(curStart.getUTCDate() - 30);
  const priorEnd = new Date(curStart);
  const priorStart = new Date(priorEnd);
  priorStart.setUTCDate(priorStart.getUTCDate() - 30);
  return { curStart, endExclusive, priorStart, priorEnd: priorEnd };
}

/** @param {Date} startInclusive @param {Date} endExclusive */
function formatCompletedUtcWeekRangeLabel(startInclusive, endExclusive) {
  return formatUtcDateRangeLabel(startInclusive, endExclusive);
}

/**
 * @param {number|null|undefined} mX
 * @param {number|null|undefined} bX
 */
function fmtMemberBotSpread(mX, bX) {
  if (mX == null || bX == null || !Number.isFinite(mX) || !Number.isFinite(bX)) {
    return { line: '—', memberAhead: null, foot: '—' };
  }
  const d = mX - bX;
  const sign = d > 0 ? '+' : '';
  return {
    line: `${sign}${d.toFixed(2)}×`,
    memberAhead: d >= 0,
    foot: d >= 0 ? 'Members ahead of bot' : 'Bot ahead of members'
  };
}

/**
 * @returns {import('./dailyDigestPanel').DailyDigestData}
 */
function buildSampleDailyDigestData(anchor = new Date()) {
  const d = new Date(anchor);
  d.setUTCDate(d.getUTCDate() - 1);
  const dateLabel = d.toISOString().slice(0, 10);
  const caller = getTestCallerHandle();

  return {
    dateLabel: `UTC ${dateLabel}`,
    isSample: true,
    memberAvgX: 4.82,
    priorMemberAvgX: 3.91,
    botAvgX: 3.44,
    leaderboard: [
      { username: caller, avgX: 12.4, totalCalls: 3 },
      { username: 'SolHunter', avgX: 8.15, totalCalls: 2 },
      { username: 'DegenMike', avgX: 5.6, totalCalls: 4 },
      { username: 'ChartWizard', avgX: 4.2, totalCalls: 2 }
    ],
    bestHuman: { ticker: 'WOJAK', x: 18.5 },
    bestBot: { ticker: 'OMNIPHX', x: 32.3 }
  };
}

/**
 * @param {Date} anchor
 * @returns {import('./dailyDigestPanel').DailyDigestData}
 */
function buildLiveDailyDigestData(anchor = new Date()) {
  const { yesterday, prior, yesterdayLabel } = getUtcYesterdayAndPriorDeskAvgs(anchor);
  const rows = getCallerLeaderboardInTimeframe(1, 4);
  const bestHuman = getBestCallInTimeframe(1);
  const bestBot = getBestBotCallInTimeframe(1);

  return {
    dateLabel: `UTC ${yesterdayLabel}`,
    isSample: false,
    memberAvgX:
      yesterday.memberAvgX != null && Number.isFinite(Number(yesterday.memberAvgX))
        ? Number(yesterday.memberAvgX)
        : null,
    priorMemberAvgX:
      prior.memberAvgX != null && Number.isFinite(Number(prior.memberAvgX))
        ? Number(prior.memberAvgX)
        : null,
    botAvgX:
      yesterday.botAvgX != null && Number.isFinite(Number(yesterday.botAvgX))
        ? Number(yesterday.botAvgX)
        : null,
    leaderboard: rows.map(r => ({
      username: r.username,
      avgX: r.avgX,
      totalCalls: r.totalCalls
    })),
    bestHuman: bestHuman
      ? { ticker: bestHuman.ticker, x: Number(bestHuman.x) || 0 }
      : null,
    bestBot: bestBot ? { ticker: bestBot.ticker, x: Number(bestBot.x) || 0 } : null
  };
}

/**
 * @param {Date} [anchor]
 * @param {{ sampleData?: boolean }} [opts]
 */
function resolveDailyDigestData(anchor = new Date(), opts = {}) {
  if (opts.sampleData === true) {
    return buildSampleDailyDigestData(anchor);
  }
  return buildLiveDailyDigestData(anchor);
}

/**
 * @returns {import('./dailyDigestPanel').WeeklyDigestData}
 */
function buildSampleWeeklyDigestData(anchor = new Date()) {
  const { startInclusive, endExclusive } = getPreviousCompletedUtcWeekBounds(anchor);
  const caller = getTestCallerHandle();

  return {
    dateLabel: formatCompletedUtcWeekRangeLabel(startInclusive, endExclusive),
    isSample: true,
    memberAvgX: 5.12,
    priorMemberAvgX: 4.44,
    botAvgX: 4.01,
    leaderboard: [
      { username: caller, avgX: 9.8, totalCalls: 5 },
      { username: 'SolHunter', avgX: 7.2, totalCalls: 4 },
      { username: 'DegenMike', avgX: 5.9, totalCalls: 6 },
      { username: 'ChartWizard', avgX: 4.8, totalCalls: 3 },
      { username: 'AlphaSeeker', avgX: 3.9, totalCalls: 2 }
    ],
    bestHuman: { ticker: 'BONK', x: 24.1 },
    bestBot: { ticker: 'OMNIPHX', x: 41.5 }
  };
}

/**
 * @param {Date} anchor
 * @returns {import('./dailyDigestPanel').WeeklyDigestData}
 */
function buildLiveWeeklyDigestData(anchor = new Date()) {
  const { startInclusive, endExclusive } = getPreviousCompletedUtcWeekBounds(anchor);
  const cur = getDeskAvgAthXPairForUtcRange(startInclusive, endExclusive);
  const prevStart = new Date(startInclusive);
  prevStart.setUTCDate(prevStart.getUTCDate() - 7);
  const prior = getDeskAvgAthXPairForUtcRange(prevStart, startInclusive);
  const rows = getCallerLeaderboardInUtcWeekBounds(startInclusive, endExclusive, 5);
  const bestHuman = getBestCallInUtcWeekBounds(startInclusive, endExclusive);
  const bestBot = getBestBotCallInUtcWeekBounds(startInclusive, endExclusive);

  return {
    dateLabel: formatCompletedUtcWeekRangeLabel(startInclusive, endExclusive),
    isSample: false,
    memberAvgX:
      cur.memberAvgX != null && Number.isFinite(Number(cur.memberAvgX))
        ? Number(cur.memberAvgX)
        : null,
    priorMemberAvgX:
      prior.memberAvgX != null && Number.isFinite(Number(prior.memberAvgX))
        ? Number(prior.memberAvgX)
        : null,
    botAvgX:
      cur.botAvgX != null && Number.isFinite(Number(cur.botAvgX)) ? Number(cur.botAvgX) : null,
    leaderboard: rows.map(r => ({
      username: r.username,
      avgX: r.avgX,
      totalCalls: r.totalCalls
    })),
    bestHuman: bestHuman
      ? { ticker: bestHuman.ticker, x: Number(bestHuman.x) || 0 }
      : null,
    bestBot: bestBot ? { ticker: bestBot.ticker, x: Number(bestBot.x) || 0 } : null
  };
}

/**
 * @param {Date} [anchor]
 * @param {{ sampleData?: boolean }} [opts]
 */
function resolveWeeklyDigestData(anchor = new Date(), opts = {}) {
  if (opts.sampleData === true) {
    return buildSampleWeeklyDigestData(anchor);
  }
  return buildLiveWeeklyDigestData(anchor);
}

/**
 * @returns {import('./dailyDigestPanel').MonthlyDigestData}
 */
function buildSampleMonthlyDigestData(anchor = new Date()) {
  const { curStart, endExclusive } = getUtcRolling30AndPrior30Bounds(anchor);
  const caller = getTestCallerHandle();

  return {
    dateLabel: formatUtcDateRangeLabel(curStart, endExclusive),
    isSample: true,
    memberAvgX: 4.68,
    priorMemberAvgX: 4.12,
    botAvgX: 3.88,
    leaderboard: [
      { username: caller, avgX: 11.2, totalCalls: 18 },
      { username: 'SolHunter', avgX: 8.4, totalCalls: 14 },
      { username: 'DegenMike', avgX: 6.1, totalCalls: 22 },
      { username: 'ChartWizard', avgX: 5.3, totalCalls: 11 },
      { username: 'AlphaSeeker', avgX: 4.7, totalCalls: 9 },
      { username: 'MoonRunner', avgX: 4.1, totalCalls: 7 },
      { username: 'TapeReader', avgX: 3.6, totalCalls: 6 },
      { username: 'EdgeFinder', avgX: 3.2, totalCalls: 5 }
    ],
    bestHuman: { ticker: 'PEPE', x: 28.4 },
    bestBot: { ticker: 'OMNIPHX', x: 45.2 }
  };
}

/**
 * @param {Date} anchor
 * @returns {import('./dailyDigestPanel').MonthlyDigestData}
 */
function buildLiveMonthlyDigestData(anchor = new Date()) {
  const { curStart, endExclusive, priorStart, priorEnd } = getUtcRolling30AndPrior30Bounds(anchor);
  const cur = getDeskAvgAthXPairForUtcRange(curStart, endExclusive);
  const prior = getDeskAvgAthXPairForUtcRange(priorStart, priorEnd);
  const rows = getCallerLeaderboardInTimeframe(30, 8);
  const bestHuman = getBestCallInTimeframe(30);
  const bestBot = getBestBotCallInTimeframe(30);

  return {
    dateLabel: formatUtcDateRangeLabel(curStart, endExclusive),
    isSample: false,
    memberAvgX:
      cur.memberAvgX != null && Number.isFinite(Number(cur.memberAvgX))
        ? Number(cur.memberAvgX)
        : null,
    priorMemberAvgX:
      prior.memberAvgX != null && Number.isFinite(Number(prior.memberAvgX))
        ? Number(prior.memberAvgX)
        : null,
    botAvgX:
      cur.botAvgX != null && Number.isFinite(Number(cur.botAvgX)) ? Number(cur.botAvgX) : null,
    leaderboard: rows.map(r => ({
      username: r.username,
      avgX: r.avgX,
      totalCalls: r.totalCalls
    })),
    bestHuman: bestHuman
      ? { ticker: bestHuman.ticker, x: Number(bestHuman.x) || 0 }
      : null,
    bestBot: bestBot ? { ticker: bestBot.ticker, x: Number(bestBot.x) || 0 } : null
  };
}

/**
 * @param {Date} [anchor]
 * @param {{ sampleData?: boolean }} [opts]
 */
function resolveMonthlyDigestData(anchor = new Date(), opts = {}) {
  if (opts.sampleData === true) {
    return buildSampleMonthlyDigestData(anchor);
  }
  return buildLiveMonthlyDigestData(anchor);
}

const DAILY_CARD_CFG = {
  title: 'Daily snapshot',
  memberSub: 'Member desk · avg ATH ×',
  leaderboardSub: 'Top callers · rolling 24h',
  quietMessage: 'Quiet day — no qualifying desk calls',
  fmtPeriodOverPeriod: fmtDayOverDay,
  maxLeaderboardRows: 4,
  displayLeaderboardRows: 4
};

const WEEKLY_CARD_CFG = {
  title: '7d snapshot',
  memberSub: 'Member desk · avg ATH ×',
  leaderboardSub: 'Top callers · completed week',
  quietMessage: 'Quiet week — no qualifying desk calls',
  fmtPeriodOverPeriod: fmtWeekOverWeek,
  maxLeaderboardRows: 5,
  displayLeaderboardRows: 5
};

const MONTHLY_CARD_CFG = {
  title: 'Monthly snapshot',
  memberSub: 'Member desk · avg ATH ×',
  leaderboardSub: 'Top callers · rolling 30d',
  quietMessage: 'Quiet month — no qualifying desk calls',
  fmtPeriodOverPeriod: fmt30dOverPrior30d,
  maxLeaderboardRows: 8,
  displayLeaderboardRows: 5
};

function metricGrad(isGood) {
  if (isGood == null) {
    return ['#e4e4e7', '#a1a1aa', '#71717a'];
  }
  return isGood
    ? ['#86efac', '#22c55e', '#16a34a']
    : ['#fca5a5', '#ef4444', '#b91c1c'];
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {number} y
 * @param {number} x0
 * @param {number} x1
 * @param {string} [color]
 */
function drawHairlineH(ctx, y, x0, x1, color = 'rgba(255,255,255,0.07)') {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y + 0.5);
  ctx.lineTo(x1, y + 0.5);
  ctx.stroke();
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y0
 * @param {number} y1
 */
function drawHairlineV(ctx, x, y0, y1) {
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 0.5, y0);
  ctx.lineTo(x + 0.5, y1);
  ctx.stroke();
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {string[]} grad
 */
function drawTitleGradient(ctx, text, x, y, size, grad) {
  ctx.font = `800 ${size}px system-ui, "Segoe UI", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const w = ctx.measureText(text).width;
  const g = ctx.createLinearGradient(x, y, x + w, y + size);
  g.addColorStop(0, grad[0]);
  g.addColorStop(0.45, grad[1]);
  g.addColorStop(1, grad[2]);
  ctx.fillStyle = g;
  ctx.fillText(text, x, y);
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @param {string} font
 */
function truncateToWidth(ctx, text, maxWidth, font) {
  let s = String(text || '');
  ctx.font = font;
  if (ctx.measureText(s).width <= maxWidth) return s;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) {
    s = s.slice(0, -1);
  }
  return `${s}…`;
}

/**
 * @param {{ ticker: string, x: number }|null} call
 */
function formatHighlight(call) {
  if (!call || !call.ticker) return null;
  const raw = String(call.ticker || '')
    .trim()
    .replace(/^\$+/u, '');
  const t = raw.length > 11 ? `${raw.slice(0, 9)}…` : raw;
  const mult = Number(call.x) || 0;
  const multStr = mult % 1 === 0 ? `${Math.round(mult)}×` : `${mult.toFixed(1)}×`;
  return { ticker: t.toUpperCase(), mult: multStr };
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {string} label
 * @param {{ ticker: string, mult: string }|null} hi
 * @param {{ primary: string, soft: string, grad: string[] }} col
 * @param {import('canvas').Image|null} [avatar]
 */
function drawBestCallStrip(ctx, x, y, w, h, label, hi, col, avatar = null) {
  drawHairlineH(ctx, y + h, x, x + w, 'rgba(255,255,255,0.05)');

  const av = avatar ? 44 : 0;
  const innerRight = x + w - (avatar ? av + 20 : 12);
  const innerLeft = x + 4;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = DIM;
  ctx.font = '600 11px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(label, innerLeft, y + 10);

  if (!hi) {
    ctx.fillStyle = DIM;
    ctx.font = '600 18px system-ui, "Segoe UI", sans-serif';
    ctx.fillText('—', innerLeft, y + 36);
    return;
  }

  const midY = y + h / 2 + 6;
  const tickMaxW = innerRight - innerLeft - 120;
  ctx.fillStyle = TEXT;
  const tickSize = fitFontSize(ctx, hi.ticker, tickMaxW, 34, 22, '700');
  ctx.font = `700 ${tickSize}px system-ui, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(hi.ticker, innerLeft, midY);

  const multSize = fitFontSize(ctx, hi.mult, 130, 52, 32, '800');
  drawGradientNumber(
    ctx,
    hi.mult,
    innerRight,
    midY + multSize * 0.34,
    multSize,
    col.grad,
    col.primary,
    { shadowBlur: 14, glow: true, align: 'right' }
  );

  if (avatar) {
    const ax = x + w - av - 12;
    const ay = y + (h - av) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax + av / 2, ay + av / 2, av / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, ax, ay, av, av);
    ctx.restore();
    ctx.strokeStyle = col.primary + '99';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ax + av / 2, ay + av / 2, av / 2 + 1, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {number} bandY
 * @param {number} bandH
 * @param {import('canvas').Image} chartImage
 */
function drawChartBand(ctx, bandY, bandH, chartImage) {
  const x = PAD;
  const w = W - PAD * 2;
  drawHairlineH(ctx, bandY, x, x + w, 'rgba(255,255,255,0.1)');

  ctx.save();
  ctx.globalAlpha = 0.94;
  ctx.drawImage(chartImage, x, bandY + 6, w, bandH - 12);
  ctx.restore();

  const fade = ctx.createLinearGradient(x, bandY, x, bandY + Math.min(72, bandH * 0.35));
  fade.addColorStop(0, 'rgba(0,0,2,0.92)');
  fade.addColorStop(1, 'rgba(0,0,2,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(x, bandY, w, Math.min(72, bandH * 0.35));

  const fadeB = ctx.createLinearGradient(x, bandY + bandH - 48, x, bandY + bandH);
  fadeB.addColorStop(0, 'rgba(0,0,2,0)');
  fadeB.addColorStop(1, 'rgba(0,0,2,0.75)');
  ctx.fillStyle = fadeB;
  ctx.fillRect(x, bandY + bandH - 48, w, 48);
}

/**
 * Premium editorial digest — open layout, no dashboard panels.
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {object} data
 * @param {{
 *   title: string,
 *   memberSub: string,
 *   leaderboardSub: string,
 *   quietMessage: string,
 *   fmtPeriodOverPeriod: (prev: number|null, cur: number|null) => string,
 *   maxLeaderboardRows?: number,
 *   displayLeaderboardRows?: number
 * }} cfg
 * @param {{ primary: string, soft: string, grad: string[] }} accent
 * @param {import('canvas').Image|null} botAvatar
 * @param {import('canvas').Image|null} [chartImage]
 */
function renderTerminalDigestCard(ctx, data, cfg, accent, botAvatar, chartImage = null) {
  const mY = data.memberAvgX;
  const bY = data.botAvgX;
  const mP = data.priorMemberAvgX;
  const periodFoot = cfg.fmtPeriodOverPeriod(mP, mY);
  const spread = fmtMemberBotSpread(mY, bY);
  const botAccent = channelAccent('bot');
  const maxRows = Number(cfg.maxLeaderboardRows) > 0 ? Number(cfg.maxLeaderboardRows) : 4;
  const displayCap =
    Number(cfg.displayLeaderboardRows) > 0 ? Number(cfg.displayLeaderboardRows) : maxRows;

  const mOk = mY != null && Number.isFinite(mY);
  const memberHero = mOk ? `${Number(mY).toFixed(2)}×` : '—';
  const memberGood = !mOk ? null : Number(mY) >= MEMBER_AVG_GOOD_AT;
  const spreadGood = spread.memberAhead;

  const footerH = 32;
  const chartBandH = chartImage ? 198 : 0;
  const contentBottom = H - PAD - footerH - chartBandH;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.font = '600 11px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('McGBot Terminal', PAD, PAD);

  drawTitleGradient(ctx, cfg.title, PAD, PAD + 20, 56, accent.grad);

  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED;
  ctx.font = '500 14px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(data.dateLabel, W - PAD, PAD + 26);
  if (data.isSample) {
    ctx.fillStyle = accent.primary + 'aa';
    ctx.font = '500 11px system-ui, "Segoe UI", sans-serif';
    ctx.fillText('Preview layout', W - PAD, PAD + 48);
  }

  const heroY = PAD + 92;
  const heroH = 168;
  const splitX = PAD + Math.floor((W - PAD * 2) * 0.58);

  drawSoftGlow(ctx, PAD + 200, heroY + heroH * 0.45, 280, accent.soft);

  ctx.textAlign = 'left';
  ctx.fillStyle = MUTED;
  ctx.font = '500 13px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(cfg.memberSub, PAD, heroY + 4);

  const memberSize = fitFontSize(ctx, memberHero, splitX - PAD - 24, 108, 56, '800');
  drawGradientNumber(
    ctx,
    memberHero,
    PAD,
    heroY + 36 + memberSize,
    memberSize,
    metricGrad(memberGood),
    accent.primary,
    { shadowBlur: 16, glow: true, align: 'left' }
  );

  ctx.fillStyle = periodFoot === '—' ? DIM : 'rgba(210, 210, 220, 0.88)';
  ctx.font = '500 14px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(periodFoot, PAD, heroY + heroH - 28);

  drawHairlineV(ctx, splitX, heroY + 8, heroY + heroH - 8);

  const spreadX = splitX + 36;
  const spreadRight = W - PAD;
  ctx.fillStyle = MUTED;
  ctx.font = '500 13px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('Member vs McGBot', spreadX, heroY + 4);

  const spreadSize = fitFontSize(ctx, spread.line, spreadRight - spreadX, 72, 44, '800');
  drawGradientNumber(
    ctx,
    spread.line,
    spreadRight,
    heroY + 40 + spreadSize,
    spreadSize,
    metricGrad(spreadGood),
    accent.primary,
    { shadowBlur: 12, glow: true, align: 'right' }
  );

  ctx.textAlign = 'left';
  ctx.fillStyle = DIM;
  ctx.font = '500 13px system-ui, "Segoe UI", sans-serif';
  const spreadFoot = truncateToWidth(ctx, spread.foot, spreadRight - spreadX, '500 13px system-ui, "Segoe UI", sans-serif');
  ctx.fillText(spreadFoot, spreadX, heroY + heroH - 28);

  const mainY = heroY + heroH + 28;
  drawHairlineH(ctx, mainY - 12, PAD, W - PAD);

  const colGap = 40;
  const lbW = Math.floor((W - PAD * 2 - colGap) * 0.54);
  const sideX = PAD + lbW + colGap;
  const sideW = W - PAD - sideX;
  const mainH = contentBottom - mainY;

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '700 11px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('TOP CALLERS', PAD, mainY);
  ctx.fillStyle = DIM;
  ctx.font = '500 12px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(cfg.leaderboardSub, PAD, mainY + 18);

  const rows = data.leaderboard || [];
  const visibleCount = Math.min(displayCap, rows.length);
  const overflow = rows.length - visibleCount;
  const rowStart = mainY + 44;
  const rowH = Math.min(38, Math.floor((mainH - 52) / Math.max(visibleCount || 1, 1)));
  const multX = PAD + lbW - 8;
  const callsX = multX - 96;

  if (visibleCount) {
    for (let i = 0; i < visibleCount; i += 1) {
      const r = rows[i];
      const ry = rowStart + i * rowH;
      const rankCy = ry + rowH / 2;

      if (i > 0) {
        drawHairlineH(ctx, ry, PAD, PAD + lbW - 8, 'rgba(255,255,255,0.04)');
      }

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = i === 0 ? accent.primary : DIM;
      ctx.font = `600 ${i === 0 ? 13 : 12}px system-ui, "Segoe UI", sans-serif`;
      ctx.fillText(String(i + 1).padStart(2, '0'), PAD, rankCy);

      ctx.fillStyle = i === 0 ? TEXT : 'rgba(235, 235, 240, 0.92)';
      ctx.font = `600 ${i === 0 ? 17 : 15}px system-ui, "Segoe UI", sans-serif`;
      const name = truncateToWidth(
        ctx,
        r.username,
        callsX - PAD - 36,
        `600 ${i === 0 ? 17 : 15}px system-ui, "Segoe UI", sans-serif`
      );
      ctx.fillText(name, PAD + 32, rankCy);

      const multStr = `${Number(r.avgX).toFixed(2)}×`;
      ctx.textAlign = 'right';
      if (i === 0) {
        const multSize = fitFontSize(ctx, multStr, 100, 22, 16, '800');
        drawGradientNumber(
          ctx,
          multStr,
          multX,
          rankCy + multSize * 0.32,
          multSize,
          accent.grad,
          accent.primary,
          { shadowBlur: 10, align: 'right' }
        );
      } else {
        ctx.fillStyle = 'rgba(200, 200, 210, 0.9)';
        ctx.font = '600 15px system-ui, "Segoe UI", sans-serif';
        ctx.fillText(multStr, multX, rankCy);
      }

      ctx.fillStyle = DIM;
      ctx.font = '500 12px system-ui, "Segoe UI", sans-serif';
      ctx.fillText(`${r.totalCalls} calls`, callsX, rankCy);
    }
    if (overflow > 0) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = DIM;
      ctx.font = '500 12px system-ui, "Segoe UI", sans-serif';
      ctx.fillText(`+${overflow} more on dashboard`, PAD, rowStart + visibleCount * rowH + 4);
    }
  } else {
    ctx.fillStyle = DIM;
    ctx.font = '500 14px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(cfg.quietMessage, PAD, rowStart);
  }

  drawHairlineV(ctx, sideX - 20, mainY, contentBottom - 8);

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '700 11px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('BEST CALLS', sideX, mainY);

  const hiHuman = formatHighlight(data.bestHuman);
  const hiBot = formatHighlight(data.bestBot);
  const stripGap = 8;
  const stripH = Math.floor((mainH - 24 - stripGap) / 2);

  drawBestCallStrip(ctx, sideX, mainY + 28, sideW, stripH, 'Best member call', hiHuman, accent, null);
  drawBestCallStrip(
    ctx,
    sideX,
    mainY + 28 + stripH + stripGap,
    sideW,
    stripH,
    'Best McGBot call',
    hiBot,
    botAccent,
    botAvatar
  );

  if (chartImage && chartBandH > 0) {
    const bandY = contentBottom + 8;
    drawChartBand(ctx, bandY, chartBandH - 8, chartImage);
  }

  const footerY = H - PAD;
  drawHairlineH(ctx, footerY - 22, PAD, W - PAD, 'rgba(255,255,255,0.06)');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = DIM;
  ctx.font = '500 13px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('🔹 Tracked live · link in bio', PAD, footerY);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(170, 170, 182, 0.95)';
  ctx.font = '600 14px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('mcgbot.xyz', W - PAD, footerY);
}

/**
 * Elite daily digest card (1200×820) — same shell as milestone data cards.
 * @param {Date} [anchor]
 * @param {{ sampleData?: boolean }} [opts] Pass `sampleData: true` for layout preview / filler stats.
 * @returns {Promise<Buffer>}
 */
async function buildDailyDigestCardPng(anchor = new Date(), opts = {}) {
  const data = resolveDailyDigestData(anchor, opts);
  const accent = channelAccent('member');
  const glow = accent.soft;
  const [mgImg, botAvatar] = await Promise.all([loadMgMarkImage(), loadMcGBotAvatarImage()]);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  paintCardBackground(ctx, W, H, glow, accent.primary);
  paintMgWatermark(ctx, mgImg, W, H);
  renderTerminalDigestCard(ctx, data, DAILY_CARD_CFG, accent, botAvatar);

  return canvas.toBuffer('image/png');
}

/**
 * Elite weekly digest card (1200×820) — terminal layout + embedded weekday avg× chart.
 * @param {Date} [anchor]
 * @param {{ sampleData?: boolean }} [opts]
 * @returns {Promise<Buffer>}
 */
async function buildWeeklyDigestCardPng(anchor = new Date(), opts = {}) {
  const data = resolveWeeklyDigestData(anchor, opts);
  const accent = channelAccent('member');
  const glow = accent.soft;
  const [mgImg, botAvatar, chartBuf] = await Promise.all([
    loadMgMarkImage(),
    loadMcGBotAvatarImage(),
    buildWeeklyAvgXpDigestPng(anchor).catch(err => {
      console.error('[buildWeeklyDigestCardPng] weekday chart failed:', err?.message || err);
      return null;
    })
  ]);

  let chartImage = null;
  if (chartBuf) {
    try {
      chartImage = await loadImage(chartBuf);
    } catch (err) {
      console.error('[buildWeeklyDigestCardPng] chart image load failed:', err?.message || err);
    }
  }

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  paintCardBackground(ctx, W, H, glow, accent.primary);
  paintMgWatermark(ctx, mgImg, W, H);
  renderTerminalDigestCard(ctx, data, WEEKLY_CARD_CFG, accent, botAvatar, chartImage);

  return canvas.toBuffer('image/png');
}

/**
 * Elite monthly digest card (1200×820) — terminal layout + embedded 30d avg× trend chart.
 * @param {Date} [anchor]
 * @param {{ sampleData?: boolean }} [opts]
 * @returns {Promise<Buffer>}
 */
async function buildMonthlyDigestCardPng(anchor = new Date(), opts = {}) {
  const data = resolveMonthlyDigestData(anchor, opts);
  const accent = channelAccent('member');
  const glow = accent.soft;
  const [mgImg, botAvatar, chartBuf] = await Promise.all([
    loadMgMarkImage(),
    loadMcGBotAvatarImage(),
    buildPast30DaysDigestPng(anchor, 30).catch(err => {
      console.error('[buildMonthlyDigestCardPng] 30d chart failed:', err?.message || err);
      return null;
    })
  ]);

  let chartImage = null;
  if (chartBuf) {
    try {
      chartImage = await loadImage(chartBuf);
    } catch (err) {
      console.error('[buildMonthlyDigestCardPng] chart image load failed:', err?.message || err);
    }
  }

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  paintCardBackground(ctx, W, H, glow, accent.primary);
  paintMgWatermark(ctx, mgImg, W, H);
  renderTerminalDigestCard(ctx, data, MONTHLY_CARD_CFG, accent, botAvatar, chartImage);

  return canvas.toBuffer('image/png');
}

/** @deprecated use buildDailyDigestCardPng */
async function buildDailySnapshotModulesPng(anchor = new Date()) {
  return buildDailyDigestCardPng(anchor);
}

module.exports = {
  buildDailyDigestCardPng,
  buildWeeklyDigestCardPng,
  buildMonthlyDigestCardPng,
  buildDailySnapshotModulesPng,
  buildSampleDailyDigestData,
  buildLiveDailyDigestData,
  resolveDailyDigestData,
  buildSampleWeeklyDigestData,
  buildLiveWeeklyDigestData,
  resolveWeeklyDigestData,
  buildSampleMonthlyDigestData,
  buildLiveMonthlyDigestData,
  resolveMonthlyDigestData
};
