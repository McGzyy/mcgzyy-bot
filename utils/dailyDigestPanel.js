'use strict';

const { createCanvas } = require('canvas');
const {
  TEXT,
  MUTED,
  DIM,
  fitFontSize,
  channelAccent,
  roundRectPath
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
  memberSub: 'Avg ATH × · last UTC day',
  leaderboardSub: 'Top 4 · avg ATH × · rolling 24h',
  quietMessage: 'Quiet day — no qualifying desk calls',
  fmtPeriodOverPeriod: fmtDayOverDay,
  maxLeaderboardRows: 4
};

const WEEKLY_CARD_CFG = {
  title: '7d snapshot',
  memberSub: 'Avg ATH × · completed UTC week',
  leaderboardSub: 'Top 5 · avg ATH × · completed week',
  quietMessage: 'Quiet week — no qualifying desk calls',
  fmtPeriodOverPeriod: fmtWeekOverWeek,
  maxLeaderboardRows: 5
};

const MONTHLY_CARD_CFG = {
  title: 'Monthly snapshot',
  memberSub: 'Avg ATH × · last 30 UTC days',
  leaderboardSub: 'Top 8 · avg ATH × · rolling 30d',
  quietMessage: 'Quiet month — no qualifying desk calls',
  fmtPeriodOverPeriod: fmt30dOverPrior30d,
  maxLeaderboardRows: 8
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
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 * @param {{ primary: string, soft: string }} accent
 */
function drawGlassPanel(ctx, x, y, w, h, r, accent) {
  roundRectPath(ctx, x, y, w, h, r);
  const fill = ctx.createLinearGradient(x, y, x, y + h);
  fill.addColorStop(0, 'rgba(22, 22, 34, 0.96)');
  fill.addColorStop(1, 'rgba(6, 6, 12, 0.98)');
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, x, y, w, h, r);
  ctx.stroke();

  ctx.strokeStyle = accent.primary + '44';
  roundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(4, r - 1));
  ctx.stroke();

  ctx.save();
  roundRectPath(ctx, x + 2, y + 2, w - 4, Math.min(h * 0.42, 72), r - 2);
  const shine = ctx.createLinearGradient(x, y, x, y + 80);
  shine.addColorStop(0, 'rgba(255,255,255,0.08)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.fill();
  ctx.restore();
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
 * @param {number} x
 * @param {number} y
 * @param {string} text
 * @param {string} color
 */
function drawDateChip(ctx, x, y, text, color) {
  ctx.font = '600 12px system-ui, "Segoe UI", sans-serif';
  const tw = ctx.measureText(text).width;
  const bw = tw + 22;
  const bh = 26;
  roundRectPath(ctx, x - bw, y, bw, bh, 10);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fill();
  ctx.strokeStyle = color + '66';
  ctx.lineWidth = 1;
  roundRectPath(ctx, x - bw, y, bw, bh, 10);
  ctx.stroke();
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x - 11, y + bh / 2);
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {string} text
 * @param {string} color
 */
function drawPreviewBadge(ctx, x, y, text, color) {
  ctx.font = '700 10px system-ui, "Segoe UI", sans-serif';
  const tw = ctx.measureText(text).width;
  const bw = tw + 16;
  const bh = 20;
  roundRectPath(ctx, x - bw, y, bw, bh, 6);
  ctx.fillStyle = color + '18';
  ctx.fill();
  ctx.strokeStyle = color + '77';
  ctx.lineWidth = 1;
  roundRectPath(ctx, x - bw, y, bw, bh, 6);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x - 8, y + bh / 2);
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
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {{ label: string, sub: string, hero: string, grad: string[], foot: string }} p
 * @param {{ primary: string, soft: string, grad: string[] }} accent
 */
function drawHeroMetricPanel(ctx, x, y, w, h, p, accent) {
  drawGlassPanel(ctx, x, y, w, h, 22, accent);

  ctx.save();
  roundRectPath(ctx, x, y, w, h, 22);
  ctx.clip();

  const inner = x + 22;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = accent.primary;
  ctx.font = '700 13px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(p.label.toUpperCase(), inner, y + 16);
  ctx.fillStyle = MUTED;
  ctx.font = '500 12px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(p.sub, inner, y + 36);

  const footFont = '600 13px system-ui, "Segoe UI", sans-serif';
  const footText = truncateToWidth(ctx, p.foot, w * 0.58, footFont);
  ctx.font = footFont;
  ctx.fillStyle = p.foot === '—' ? DIM : 'rgba(220, 220, 228, 0.92)';
  ctx.fillText(footText, inner, y + h - 28);

  const heroMaxW = w * 0.62;
  const heroSize = fitFontSize(ctx, p.hero, heroMaxW, Math.min(88, h * 0.38), 40, '800');
  const heroBaseline = y + 56 + (h - 56 - 44) * 0.62;
  drawGradientNumber(ctx, p.hero, x + w - 20, heroBaseline, heroSize, p.grad, accent.primary, {
    shadowBlur: 28
  });

  ctx.restore();
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} rank
 */
function drawRankBadge(ctx, cx, cy, rank) {
  const colors = ['#fbbf24', '#d4d4d8', '#b45309', 'rgba(255,255,255,0.14)'];
  const fill = colors[Math.min(rank - 1, 3)];
  const r = rank === 1 ? 17 : 14;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (rank > 1) {
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = rank <= 3 ? '#0a0a0f' : MUTED;
  ctx.font = `800 ${rank === 1 ? 14 : 12}px system-ui, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(rank), cx, cy + 1);
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
 * @param {object} data
 * @param {{
 *   title: string,
 *   memberSub: string,
 *   leaderboardSub: string,
 *   quietMessage: string,
 *   fmtPeriodOverPeriod: (prev: number|null, cur: number|null) => string,
 *   maxLeaderboardRows?: number
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

  const mOk = mY != null && Number.isFinite(mY);
  const memberHero = mOk ? `${Number(mY).toFixed(2)}×` : '—';
  const memberGood = !mOk ? null : Number(mY) >= MEMBER_AVG_GOOD_AT;
  const spreadGood = spread.memberAhead;

  const headerH = 108;
  drawTitleGradient(ctx, cfg.title, PAD, PAD + 18, 52, accent.grad);
  ctx.fillStyle = accent.primary;
  ctx.font = '700 12px system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('TERMINAL · DESK PERFORMANCE', PAD, PAD);

  drawDateChip(ctx, W - PAD, PAD + 4, data.dateLabel, accent.primary);
  if (data.isSample) {
    drawPreviewBadge(ctx, W - PAD, PAD + 36, 'LAYOUT PREVIEW', accent.primary);
  }

  const statsY = PAD + headerH;
  const statsH = 204;
  const colGap = 22;
  const panelW = (W - PAD * 2 - colGap) / 2;

  drawHeroMetricPanel(
    ctx,
    PAD,
    statsY,
    panelW,
    statsH,
    {
      label: 'Member desk',
      sub: cfg.memberSub,
      hero: memberHero,
      grad: metricGrad(memberGood),
      foot: periodFoot
    },
    accent
  );
  drawHeroMetricPanel(
    ctx,
    PAD + panelW + colGap,
    statsY,
    panelW,
    statsH,
    {
      label: 'Member vs McGBot',
      sub: 'Spread on avg ATH ×',
      hero: spread.line,
      grad: metricGrad(spreadGood),
      foot: spread.foot
    },
    accent
  );

  const bodyY = statsY + statsH + 22;
  const bodyH = H - bodyY - PAD - 44;
  const lbW = Math.floor((W - PAD * 2 - colGap) * 0.58);
  const sideW = W - PAD * 2 - colGap - lbW;

  drawGlassPanel(ctx, PAD, bodyY, lbW, bodyH, 22, accent);
  drawSoftGlow(ctx, PAD + lbW * 0.5, bodyY + bodyH * 0.35, 240, accent.soft);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = accent.primary;
  ctx.font = '800 22px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('Caller leaderboard', PAD + 24, bodyY + 20);
  ctx.fillStyle = MUTED;
  ctx.font = '500 13px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(cfg.leaderboardSub, PAD + 24, bodyY + 48);

  const rows = data.leaderboard || [];
  const rowStart = bodyY + 78;
  const rowH = Math.min(44, Math.floor((bodyH - 90) / Math.max(maxRows, rows.length || 1)));
  const multX = PAD + lbW - 24;
  const callsX = multX - 108;

  if (rows.length) {
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const ry = rowStart + i * rowH;
      const rankCy = ry + rowH / 2;
      const rowPad = PAD + 16;

      if (i === 0) {
        roundRectPath(ctx, rowPad, ry + 2, lbW - 32, rowH - 4, 12);
        ctx.fillStyle = accent.primary + '14';
        ctx.fill();
        ctx.strokeStyle = accent.primary + '35';
        ctx.lineWidth = 1;
        roundRectPath(ctx, rowPad, ry + 2, lbW - 32, rowH - 4, 12);
        ctx.stroke();
      }

      drawRankBadge(ctx, rowPad + 22, rankCy, i + 1);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = i === 0 ? TEXT : 'rgba(235, 235, 240, 0.95)';
      ctx.font = `700 ${i === 0 ? 18 : 16}px system-ui, "Segoe UI", sans-serif`;
      const nameMaxW = callsX - (rowPad + 48) - 12;
      const name = truncateToWidth(
        ctx,
        r.username,
        nameMaxW,
        `700 ${i === 0 ? 18 : 16}px system-ui, "Segoe UI", sans-serif`
      );
      ctx.fillText(name, rowPad + 48, rankCy);

      const multStr = `${Number(r.avgX).toFixed(2)}×`;
      const multSize = fitFontSize(ctx, multStr, 96, i === 0 ? 24 : 20, 15, '800');
      if (i === 0) {
        drawGradientNumber(
          ctx,
          multStr,
          multX,
          rankCy + multSize * 0.32,
          multSize,
          accent.grad,
          accent.primary,
          { shadowBlur: 20 }
        );
      } else {
        ctx.textAlign = 'right';
        ctx.fillStyle = accent.primary;
        ctx.font = `800 ${multSize}px system-ui, "Segoe UI", sans-serif`;
        ctx.fillText(multStr, multX, rankCy);
      }

      ctx.textAlign = 'right';
      ctx.fillStyle = DIM;
      ctx.font = '500 13px system-ui, "Segoe UI", sans-serif';
      ctx.fillText(
        `${r.totalCalls} call${r.totalCalls === 1 ? '' : 's'}`,
        callsX,
        rankCy
      );
    }
  } else {
    ctx.fillStyle = DIM;
    ctx.font = '600 15px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(cfg.quietMessage, PAD + 24, rowStart + 12);
  }

  const sideX = PAD + lbW + colGap;
  const hiGap = 16;
  const hiH = chartImage ? 76 : Math.floor((bodyH - hiGap) / 2);
  const chartH = chartImage ? bodyH - hiH * 2 - hiGap * 2 : 0;
  const hiHuman = formatHighlight(data.bestHuman);
  const hiBot = formatHighlight(data.bestBot);

  /**
   * @param {number} hy
   * @param {string} label
   * @param {{ ticker: string, mult: string }|null} hi
   * @param {{ primary: string, soft: string, grad: string[] }} col
   * @param {import('canvas').Image|null} [avatar]
   */
  function drawHighlightCard(hy, label, hi, col, avatar) {
    drawGlassPanel(ctx, sideX, hy, sideW, hiH, 18, col);

    ctx.save();
    roundRectPath(ctx, sideX, hy, sideW, hiH, 18);
    ctx.clip();

    const av = avatar ? 48 : 0;
    const avPad = 16;
    const textMaxW = sideW - av - avPad * 2 - (avatar ? 12 : 0);

    if (avatar) {
      const ax = sideX + sideW - av - avPad;
      const ay = hy + (hiH - av) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(ax + av / 2, ay + av / 2, av / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(avatar, ax, ay, av, av);
      ctx.restore();
      ctx.strokeStyle = col.primary;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ax + av / 2, ay + av / 2, av / 2 + 1, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = col.primary;
    ctx.font = '700 11px system-ui, "Segoe UI", sans-serif';
    ctx.fillText(label.toUpperCase(), sideX + avPad, hy + 14);

    if (!hi) {
      ctx.fillStyle = DIM;
      ctx.font = '600 16px system-ui, "Segoe UI", sans-serif';
      ctx.fillText('—', sideX + avPad, hy + 40);
      ctx.restore();
      return;
    }

    ctx.fillStyle = TEXT;
    const tickSize = fitFontSize(ctx, hi.ticker, textMaxW, 30, 20, '800');
    ctx.font = `800 ${tickSize}px system-ui, "Segoe UI", sans-serif`;
    ctx.fillText(hi.ticker, sideX + avPad, hy + 36);

    const multSize = fitFontSize(ctx, hi.mult, textMaxW, 48, 28, '800');
    drawGradientNumber(
      ctx,
      hi.mult,
      sideX + avPad,
      hy + hiH - 24,
      multSize,
      col.grad,
      col.primary,
      { shadowBlur: avatar ? 16 : 22, align: 'left' }
    );

    ctx.restore();
  }

  drawHighlightCard(bodyY, 'Best member call', hiHuman, accent, null);
  drawHighlightCard(bodyY + hiH + hiGap, 'Best McGBot call', hiBot, botAccent, botAvatar);

  if (chartImage && chartH > 40) {
    const chartY = bodyY + hiH * 2 + hiGap * 2;
    drawGlassPanel(ctx, sideX, chartY, sideW, chartH, 16, accent);
    ctx.save();
    roundRectPath(ctx, sideX + 8, chartY + 8, sideW - 16, chartH - 16, 12);
    ctx.clip();
    ctx.drawImage(chartImage, sideX + 8, chartY + 8, sideW - 16, chartH - 16);
    ctx.restore();
  }

  const footerY = H - PAD - 4;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = MUTED;
  ctx.font = '600 15px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('🔹 Dashboard link in bio', PAD, footerY);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(180, 180, 192, 0.98)';
  ctx.font = '700 17px system-ui, "Segoe UI", sans-serif';
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
