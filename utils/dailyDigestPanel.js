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
/** Subtle section separators (editorial, not dashboard panels). */
const SECTION_LINE = 'rgba(255,255,255,0.16)';
const SECTION_LINE_SOFT = 'rgba(255,255,255,0.09)';
const CHART_BAND_FULL = 272;
const CARD_CHART_W = W - PAD * 2;
const CARD_CHART_H = 248;
const DIGEST_CHART_OPTS = { forCardEmbed: true, width: CARD_CHART_W, height: CARD_CHART_H };
const CHART_SLIDE_W = W - PAD * 2;
const CHART_SLIDE_H = 560;

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
function drawHairlineH(ctx, y, x0, x1, color = SECTION_LINE_SOFT) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y + 0.5);
  ctx.lineTo(x1, y + 0.5);
  ctx.stroke();
}

/** Full-width section rule between major bands. */
function drawSectionRule(ctx, y, strong = true) {
  drawHairlineH(ctx, y, PAD, W - PAD, strong ? SECTION_LINE : SECTION_LINE_SOFT);
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {object} data
 * @param {{ title: string }} cfg
 * @param {{ primary: string, grad: string[] }} accent
 * @param {{ compact?: boolean, slideTag?: string, chartKicker?: string }} [opts]
 */
function drawDigestHeader(ctx, data, cfg, accent, opts = {}) {
  const compact = opts.compact === true;
  const titleSize = compact ? 40 : 56;
  const titleY = compact ? PAD + 14 : PAD + 20;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.font = '600 11px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('McGBot Terminal', PAD, PAD);

  drawTitleGradient(ctx, cfg.title, PAD, titleY, titleSize, accent.grad);

  if (opts.chartKicker) {
    ctx.fillStyle = MUTED;
    ctx.font = '500 13px system-ui, "Segoe UI", sans-serif';
    ctx.fillText(opts.chartKicker, PAD, titleY + titleSize + 10);
  }

  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED;
  ctx.font = '500 14px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(data.dateLabel, W - PAD, PAD + (compact ? 20 : 26));
  if (data.isSample) {
    ctx.fillStyle = accent.primary + 'aa';
    ctx.font = '500 11px system-ui, "Segoe UI", sans-serif';
    ctx.fillText('Preview layout', W - PAD, PAD + (compact ? 38 : 48));
  }
  if (opts.slideTag) {
    ctx.fillStyle = DIM;
    ctx.font = '600 11px system-ui, "Segoe UI", sans-serif';
    ctx.fillText(opts.slideTag, W - PAD, PAD + (compact ? 56 : 66));
  }
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 */
function drawDigestFooter(ctx) {
  const footerY = H - PAD;
  drawSectionRule(ctx, footerY - 22, false);
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
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {string} slideTag e.g. "2 of 3"
 * @param {{ primary: string }} accent
 */
function drawSlideBadge(ctx, slideTag, accent) {
  if (!slideTag) return;
  const label = slideTag.replace(/\s*\/\s*/g, ' of ');
  ctx.font = '600 12px system-ui, "Segoe UI", sans-serif';
  const tw = ctx.measureText(label).width;
  const bw = tw + 20;
  const bh = 28;
  const x = W - PAD - bw;
  const y = PAD + 52;
  roundRectPath(ctx, x, y, bw, bh, 14);
  ctx.fillStyle = accent.primary + '14';
  ctx.fill();
  ctx.strokeStyle = accent.primary + '55';
  ctx.lineWidth = 1;
  roundRectPath(ctx, x, y, bw, bh, 14);
  ctx.stroke();
  ctx.fillStyle = accent.primary;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + bw / 2, y + bh / 2 + 1);
}

/**
 * Carousel slide chrome — consistent header without repeating a cramped full dashboard title.
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {object} data
 * @param {{ title: string }} cfg
 * @param {{ primary: string, grad: string[] }} accent
 * @param {{ headline: string, subline?: string, slideTag?: string, titleSize?: number }} opts
 * @returns {number} y where content should start
 */
function drawCarouselChrome(ctx, data, cfg, accent, opts) {
  const titleSize = opts.titleSize || 44;
  const headline = opts.headline || cfg.title;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.font = '600 11px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('McGBot Terminal', PAD, PAD);

  drawTitleGradient(ctx, headline, PAD, PAD + 16, titleSize, accent.grad);

  let subY = PAD + 16 + titleSize + 6;
  if (opts.subline) {
    ctx.fillStyle = MUTED;
    ctx.font = '500 14px system-ui, "Segoe UI", sans-serif';
    ctx.fillText(opts.subline, PAD, subY);
    subY += 22;
  }

  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED;
  ctx.font = '500 13px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(data.dateLabel, W - PAD, PAD + 20);
  if (data.isSample) {
    ctx.fillStyle = accent.primary + '99';
    ctx.font = '500 11px system-ui, "Segoe UI", sans-serif';
    ctx.fillText('Preview', W - PAD, PAD + 38);
  }
  if (opts.slideTag) {
    drawSlideBadge(ctx, opts.slideTag, accent);
  }

  const ruleY = Math.max(subY + 10, PAD + 88);
  drawSectionRule(ctx, ruleY);
  return ruleY + 16;
}

/**
 * Digest carousel: monthly = 3 slides; weekly = 2. Daily stays single image.
 * @param {'daily'|'weekly'|'monthly'} kind
 */
function digestCarouselEnabled(kind) {
  const raw = String(process.env.X_DIGEST_CAROUSEL ?? '0').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'all') return true;
  const kinds = raw.split(/[\s,]+/).filter(Boolean);
  if (kinds.includes('all')) return true;
  return kinds.includes(String(kind || '').toLowerCase());
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y0
 * @param {number} y1
 */
function drawHairlineV(ctx, x, y0, y1, color = SECTION_LINE_SOFT) {
  ctx.strokeStyle = color;
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

  const av = avatar ? 40 : 0;
  const innerLeft = x + 8;
  const innerRight = x + w - (avatar ? av + 14 : 8);
  const multReserve = 118;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = DIM;
  ctx.font = '600 11px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(label, innerLeft, y + 10);

  if (!hi) {
    ctx.fillStyle = DIM;
    ctx.font = '600 18px system-ui, "Segoe UI", sans-serif';
    ctx.fillText('—', innerLeft, y + 40);
    return;
  }

  const tickMaxW = innerRight - innerLeft - multReserve;
  const tickSize = fitFontSize(ctx, hi.ticker, tickMaxW, 30, 20, '700');
  const tickBaseline = y + 38 + tickSize;
  ctx.fillStyle = TEXT;
  ctx.font = `700 ${tickSize}px system-ui, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(hi.ticker, innerLeft, tickBaseline);

  const multSize = fitFontSize(ctx, hi.mult, multReserve - 8, 48, 28, '800');
  drawGradientNumber(
    ctx,
    hi.mult,
    innerRight,
    tickBaseline,
    multSize,
    col.grad,
    col.primary,
    { shadowBlur: 14, glow: true, align: 'right' }
  );

  if (avatar) {
    const ax = x + w - av - 10;
    const ay = y + Math.max(12, (h - av) / 2);
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
function drawChartBand(ctx, bandY, bandH, chartImage, opts = {}) {
  const x = PAD;
  const w = W - PAD * 2;
  const padY = opts.tight ? 6 : 10;
  const lightFade = opts.lightFade !== false;
  drawHairlineH(ctx, bandY, x, x + w, SECTION_LINE);

  ctx.save();
  ctx.globalAlpha = 0.99;
  ctx.drawImage(chartImage, x, bandY + padY, w, Math.max(48, bandH - padY * 2));
  ctx.restore();

  if (!lightFade) {
    const fade = ctx.createLinearGradient(x, bandY, x, bandY + Math.min(40, bandH * 0.16));
    fade.addColorStop(0, 'rgba(0,0,2,0.45)');
    fade.addColorStop(1, 'rgba(0,0,2,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(x, bandY, w, Math.min(40, bandH * 0.16));
  }

  const fadeB = ctx.createLinearGradient(x, bandY + bandH - 28, x, bandY + bandH);
  fadeB.addColorStop(0, 'rgba(0,0,2,0)');
  fadeB.addColorStop(1, 'rgba(0,0,2,0.35)');
  ctx.fillStyle = fadeB;
  ctx.fillRect(x, bandY + bandH - 28, w, 28);
}

/**
 * Softer MG mark for digest cards — stays off hero copy on the right.
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {import('canvas').Image|null} mgImg
 */
function paintDigestMgWatermark(ctx, mgImg) {
  if (!mgImg) return;
  const markW = Math.min(480, W * 0.5);
  const scale = markW / mgImg.width;
  const markH = mgImg.height * scale;
  const mx = W - markW - 24;
  const my = PAD + 8;

  ctx.save();
  ctx.globalAlpha = 0.055;
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(mgImg, mx, my, markW, markH);
  ctx.restore();
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {object} data
 * @param {object} cfg
 * @param {{ primary: string, soft: string, grad: string[] }} accent
 * @param {number} heroY
 * @param {number} heroH
 */
function paintDigestHeroMetrics(ctx, data, cfg, accent, heroY, heroH) {
  const mY = data.memberAvgX;
  const bY = data.botAvgX;
  const mP = data.priorMemberAvgX;
  const periodFoot = cfg.fmtPeriodOverPeriod(mP, mY);
  const spread = fmtMemberBotSpread(mY, bY);
  const mOk = mY != null && Number.isFinite(mY);
  const memberHero = mOk ? `${Number(mY).toFixed(2)}×` : '—';
  const memberGood = !mOk ? null : Number(mY) >= MEMBER_AVG_GOOD_AT;
  const spreadGood = spread.memberAhead;
  const splitX = PAD + Math.floor((W - PAD * 2) * 0.56);
  const labelH = 22;
  const footH = 24;
  const numZoneH = heroH - labelH - footH;

  drawSoftGlow(ctx, PAD + 180, heroY + heroH * 0.42, 240, accent.soft);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = MUTED;
  ctx.font = '500 13px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(cfg.memberSub, PAD, heroY + 6);

  const memberSize = fitFontSize(ctx, memberHero, splitX - PAD - 28, numZoneH - 4, 52, '800');
  const memberBaseline = heroY + labelH + memberSize;
  drawGradientNumber(
    ctx,
    memberHero,
    PAD,
    memberBaseline,
    memberSize,
    metricGrad(memberGood),
    accent.primary,
    { shadowBlur: 16, glow: true, align: 'left' }
  );

  ctx.fillStyle = periodFoot === '—' ? DIM : 'rgba(210, 210, 220, 0.9)';
  ctx.font = '500 13px system-ui, "Segoe UI", sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(periodFoot, PAD, heroY + heroH - 10);

  drawHairlineV(ctx, splitX, heroY + 10, heroY + heroH - 10, SECTION_LINE);

  const spreadX = splitX + 32;
  const spreadRight = W - PAD - 8;
  ctx.textBaseline = 'top';
  ctx.fillStyle = MUTED;
  ctx.font = '500 13px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('Member vs McGBot', spreadX, heroY + 6);

  const spreadSize = fitFontSize(ctx, spread.line, spreadRight - spreadX, numZoneH - 4, 44, '800');
  const spreadBaseline = heroY + labelH + spreadSize;
  drawGradientNumber(
    ctx,
    spread.line,
    spreadRight,
    spreadBaseline,
    spreadSize,
    metricGrad(spreadGood),
    accent.primary,
    { shadowBlur: 12, glow: true, align: 'right' }
  );

  const spreadFoot = truncateToWidth(
    ctx,
    spread.foot,
    spreadRight - spreadX,
    '500 13px system-ui, "Segoe UI", sans-serif'
  );
  ctx.fillStyle = 'rgba(0,0,2,0.72)';
  const footW = ctx.measureText(spreadFoot).width + 14;
  roundRectPath(ctx, spreadX - 4, heroY + heroH - footH - 2, footW, footH - 2, 6);
  ctx.fill();
  ctx.fillStyle = DIM;
  ctx.font = '500 13px system-ui, "Segoe UI", sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(spreadFoot, spreadX, heroY + heroH - 10);
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {object} data
 * @param {object} cfg
 * @param {{ primary: string, soft: string, grad: string[] }} accent
 * @param {import('canvas').Image|null} botAvatar
 * @param {number} mainY
 * @param {number} contentBottom
 */
function paintDigestDeskSection(ctx, data, cfg, accent, botAvatar, mainY, contentBottom) {
  const botAccent = channelAccent('bot');
  const maxRows = Number(cfg.maxLeaderboardRows) > 0 ? Number(cfg.maxLeaderboardRows) : 4;
  const displayCap =
    Number(cfg.displayLeaderboardRows) > 0 ? Number(cfg.displayLeaderboardRows) : maxRows;

  const colGap = 40;
  const lbW = Math.floor((W - PAD * 2 - colGap) * 0.54);
  const sideX = PAD + lbW + colGap;
  const sideW = W - PAD - sideX;
  const mainH = contentBottom - mainY;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
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
  const rowH = Math.min(44, Math.max(38, Math.floor((mainH - 52) / Math.max(visibleCount || 1, 1))));
  const lbRight = PAD + lbW;
  const multX = lbRight - 6;
  const callsRight = lbRight - 92;
  const nameMaxW = callsRight - PAD - 44;

  if (visibleCount) {
    for (let i = 0; i < visibleCount; i += 1) {
      const r = rows[i];
      const ry = rowStart + i * rowH;
      const rankCy = ry + rowH / 2;
      if (i > 0) {
        drawHairlineH(ctx, ry, PAD, lbRight - 8, SECTION_LINE_SOFT);
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
        nameMaxW,
        `600 ${i === 0 ? 17 : 15}px system-ui, "Segoe UI", sans-serif`
      );
      ctx.fillText(name, PAD + 32, rankCy);
      const multStr = `${Number(r.avgX).toFixed(2)}×`;
      ctx.textAlign = 'right';
      ctx.fillStyle = DIM;
      ctx.font = '500 12px system-ui, "Segoe UI", sans-serif';
      ctx.fillText(`${r.totalCalls} calls`, callsRight, rankCy);
      if (i === 0) {
        const multSize = fitFontSize(ctx, multStr, 88, 22, 16, '800');
        drawGradientNumber(
          ctx,
          multStr,
          multX,
          rankCy + multSize * 0.34,
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
    ctx.fillText(cfg.quietMessage, PAD, rowStart);
  }

  drawHairlineV(ctx, sideX - 20, mainY, contentBottom - 8, SECTION_LINE);

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '700 11px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('BEST CALLS', sideX, mainY);

  const hiHuman = formatHighlight(data.bestHuman);
  const hiBot = formatHighlight(data.bestBot);
  const stripGap = 10;
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
}

/**
 * Carousel slide 2 — full-width desk highlights (leaderboard + best calls).
 */
function paintDigestDeskSectionCarousel(ctx, data, cfg, accent, botAvatar, areaTop, areaBottom) {
  const botAccent = channelAccent('bot');
  const displayCap =
    Number(cfg.displayLeaderboardRows) > 0 ? Number(cfg.displayLeaderboardRows) : 5;
  const totalH = areaBottom - areaTop;
  const lbH = Math.floor(totalH * 0.56);
  const hiTop = areaTop + lbH + 20;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '700 11px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('TOP CALLERS', PAD, areaTop);
  ctx.fillStyle = DIM;
  ctx.font = '500 12px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(cfg.leaderboardSub, PAD, areaTop + 18);

  const rows = data.leaderboard || [];
  const visibleCount = Math.min(displayCap, rows.length);
  const overflow = rows.length - visibleCount;
  const rowStart = areaTop + 42;
  const rowH = Math.min(42, Math.floor((lbH - 48) / Math.max(visibleCount || 1, 1)));
  const multX = W - PAD - 8;
  const callsX = multX - 100;

  for (let i = 0; i < visibleCount; i += 1) {
    const r = rows[i];
    const ry = rowStart + i * rowH;
    const rankCy = ry + rowH / 2;
    if (i > 0) {
      drawHairlineH(ctx, ry, PAD, W - PAD, SECTION_LINE_SOFT);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = i === 0 ? accent.primary : DIM;
    ctx.font = `600 ${i === 0 ? 13 : 12}px system-ui, "Segoe UI", sans-serif`;
    ctx.fillText(String(i + 1).padStart(2, '0'), PAD, rankCy);
    ctx.fillStyle = i === 0 ? TEXT : 'rgba(235, 235, 240, 0.92)';
    ctx.font = `600 ${i === 0 ? 18 : 16}px system-ui, "Segoe UI", sans-serif`;
    const name = truncateToWidth(
      ctx,
      r.username,
      callsX - PAD - 40,
      `600 ${i === 0 ? 18 : 16}px system-ui, "Segoe UI", sans-serif`
    );
    ctx.fillText(name, PAD + 36, rankCy);
    const multStr = `${Number(r.avgX).toFixed(2)}×`;
    ctx.textAlign = 'right';
    if (i === 0) {
      const multSize = fitFontSize(ctx, multStr, 110, 24, 17, '800');
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
      ctx.font = '600 16px system-ui, "Segoe UI", sans-serif';
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
    ctx.fillText(`+${overflow} more on dashboard`, PAD, rowStart + visibleCount * rowH + 6);
  }

  drawSectionRule(ctx, hiTop - 12);

  const hiHuman = formatHighlight(data.bestHuman);
  const hiBot = formatHighlight(data.bestBot);
  const tileGap = 20;
  const tileW = (W - PAD * 2 - tileGap) / 2;
  const tileH = areaBottom - hiTop - 8;
  drawBestCallStrip(ctx, PAD, hiTop, tileW, tileH, 'Best member call', hiHuman, accent, null);
  drawBestCallStrip(
    ctx,
    PAD + tileW + tileGap,
    hiTop,
    tileW,
    tileH,
    'Best McGBot call',
    hiBot,
    botAccent,
    botAvatar
  );
}

/**
 * Carousel slide 1 — desk performance hero (centered poster).
 */
function renderDigestHeroSlide(ctx, data, cfg, accent, slideTag) {
  const contentTop = drawCarouselChrome(ctx, data, cfg, accent, {
    headline: cfg.title,
    subline: cfg.memberSub,
    slideTag,
    titleSize: 52
  });
  const areaBottom = H - PAD - 48;
  const blockH = 300;
  const heroY = contentTop + Math.max(0, Math.floor((areaBottom - contentTop - blockH) / 2));
  paintDigestHeroMetrics(ctx, data, cfg, accent, heroY, blockH);
  drawSectionRule(ctx, H - PAD - 44, false);
  drawDigestFooter(ctx);
}

/**
 * Carousel slide 2 — leaderboard + best calls.
 */
function renderDigestBodySlide(ctx, data, cfg, accent, botAvatar, slideTag) {
  const contentTop = drawCarouselChrome(ctx, data, cfg, accent, {
    headline: 'Desk highlights',
    subline: cfg.leaderboardSub,
    slideTag,
    titleSize: 44
  });
  paintDigestDeskSectionCarousel(ctx, data, cfg, accent, botAvatar, contentTop, H - PAD - 44);
  drawDigestFooter(ctx);
}

/**
 * Carousel slide — full-width trend chart.
 */
function renderDigestChartSlide(ctx, data, cfg, accent, chartImage, slideTag) {
  const contentTop = drawCarouselChrome(ctx, data, cfg, accent, {
    headline: '30-day trend',
    subline: 'Avg ATH × · member vs McGBot',
    slideTag,
    titleSize: 44
  });
  const bandY = contentTop + 8;
  const bandH = H - PAD - 48 - bandY;
  if (chartImage && bandH > 80) {
    drawChartBand(ctx, bandY, bandH, chartImage, { tight: true, lightFade: true });
  } else {
    ctx.fillStyle = DIM;
    ctx.font = '500 15px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Trend chart unavailable', W / 2, bandY + bandH / 2);
  }
  drawDigestFooter(ctx);
}

/**
 * Weekly carousel slide 1 — hero + desk (no chart).
 */
function renderDigestSummarySlide(ctx, data, cfg, accent, botAvatar, slideTag) {
  const contentTop = drawCarouselChrome(ctx, data, cfg, accent, {
    headline: cfg.title,
    subline: cfg.memberSub,
    slideTag,
    titleSize: 48
  });
  const heroH = 188;
  paintDigestHeroMetrics(ctx, data, cfg, accent, contentTop, heroH);
  drawSectionRule(ctx, contentTop + heroH + 14);
  paintDigestDeskSectionCarousel(
    ctx,
    data,
    cfg,
    accent,
    botAvatar,
    contentTop + heroH + 28,
    H - PAD - 44
  );
  drawDigestFooter(ctx);
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
 * @param {'full'|'hero'|'body'|'chart'|'summary'} [mode]
 * @param {string} [slideTag]
 */
function renderTerminalDigestCard(
  ctx,
  data,
  cfg,
  accent,
  botAvatar,
  chartImage = null,
  mode = 'full',
  slideTag = ''
) {
  if (mode === 'hero') {
    renderDigestHeroSlide(ctx, data, cfg, accent, slideTag || '1 / 3');
    return;
  }
  if (mode === 'body') {
    renderDigestBodySlide(ctx, data, cfg, accent, botAvatar, slideTag || '2 / 3');
    return;
  }
  if (mode === 'chart') {
    renderDigestChartSlide(ctx, data, cfg, accent, chartImage, slideTag);
    return;
  }
  if (mode === 'summary') {
    renderDigestSummarySlide(ctx, data, cfg, accent, botAvatar, slideTag || '1 / 2');
    return;
  }

  const footerH = 36;
  const chartBandH = chartImage ? CHART_BAND_FULL : 0;
  const contentBottom = H - PAD - footerH - chartBandH;

  drawDigestHeader(ctx, data, cfg, accent);
  drawSectionRule(ctx, PAD + 78);

  const heroY = PAD + 96;
  const heroH = 172;
  paintDigestHeroMetrics(ctx, data, cfg, accent, heroY, heroH);

  const mainY = heroY + heroH + 22;
  drawSectionRule(ctx, mainY - 10);
  paintDigestDeskSection(ctx, data, cfg, accent, botAvatar, mainY, contentBottom);

  if (chartImage && chartBandH > 0) {
    drawSectionRule(ctx, contentBottom + 6);
    drawChartBand(ctx, contentBottom + 12, chartBandH - 12, chartImage, { lightFade: true });
  }

  drawDigestFooter(ctx);
}

/**
 * @param {object} data
 * @param {object} cfg
 * @param {{ primary: string, soft: string, grad: string[] }} accent
 * @param {import('canvas').Image|null} botAvatar
 * @param {import('canvas').Image|null} chartImage
 * @param {'full'|'hero'|'body'|'chart'|'summary'} mode
 * @param {import('canvas').Image|null} mgImg
 */
async function renderDigestSlideBuffer(data, cfg, accent, botAvatar, chartImage, mode, mgImg, slideTag = '') {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  paintCardBackground(ctx, W, H, accent.soft, accent.primary);
  paintDigestMgWatermark(ctx, mgImg);
  renderTerminalDigestCard(ctx, data, cfg, accent, botAvatar, chartImage, mode, slideTag);
  return canvas.toBuffer('image/png');
}

/**
 * @param {Date} anchor
 * @param {{ sampleData?: boolean }} opts
 * @returns {Promise<Buffer[]>}
 */
async function buildMonthlyDigestCarouselPngs(anchor = new Date(), opts = {}) {
  const data = resolveMonthlyDigestData(anchor, opts);
  const accent = channelAccent('member');
  const [mgImg, botAvatar, chartBuf] = await Promise.all([
    loadMgMarkImage(),
    loadMcGBotAvatarImage(),
    buildPast30DaysDigestPng(anchor, 30, {
      skipPlaceholder: true,
      width: CHART_SLIDE_W,
      height: CHART_SLIDE_H
    }).catch(() => null)
  ]);
  let chartImage = null;
  if (chartBuf) {
    try {
      chartImage = await loadImage(chartBuf);
    } catch {
      chartImage = null;
    }
  }
  const slides = await Promise.all([
    renderDigestSlideBuffer(data, MONTHLY_CARD_CFG, accent, botAvatar, null, 'hero', mgImg),
    renderDigestSlideBuffer(data, MONTHLY_CARD_CFG, accent, botAvatar, null, 'body', mgImg)
  ]);
  if (chartImage) {
    slides.push(
      await renderDigestSlideBuffer(
        data,
        MONTHLY_CARD_CFG,
        accent,
        botAvatar,
        chartImage,
        'chart',
        mgImg,
        '3 / 3'
      )
    );
  }
  return slides;
}

/**
 * @param {Date} anchor
 * @param {{ sampleData?: boolean }} opts
 * @returns {Promise<Buffer[]>}
 */
async function buildWeeklyDigestCarouselPngs(anchor = new Date(), opts = {}) {
  const data = resolveWeeklyDigestData(anchor, opts);
  const accent = channelAccent('member');
  const [mgImg, botAvatar, chartBuf] = await Promise.all([
    loadMgMarkImage(),
    loadMcGBotAvatarImage(),
    buildWeeklyAvgXpDigestPng(anchor).catch(() => null)
  ]);
  let chartImage = null;
  if (chartBuf) {
    try {
      chartImage = await loadImage(chartBuf);
    } catch {
      chartImage = null;
    }
  }
  const slides = [
    await renderDigestSlideBuffer(data, WEEKLY_CARD_CFG, accent, botAvatar, null, 'summary', mgImg)
  ];
  if (chartImage) {
    slides.push(
      await renderDigestSlideBuffer(
        data,
        WEEKLY_CARD_CFG,
        accent,
        botAvatar,
        chartImage,
        'chart',
        mgImg,
        '2 / 2'
      )
    );
  }
  return slides;
}

/**
 * @param {'weekly'|'monthly'} kind
 * @param {Date} anchor
 * @param {{ sampleData?: boolean }} opts
 * @returns {Promise<Buffer[]>}
 */
async function buildDigestMediaPngs(kind, anchor = new Date(), opts = {}) {
  if (kind === 'monthly' && digestCarouselEnabled('monthly')) {
    return buildMonthlyDigestCarouselPngs(anchor, opts);
  }
  if (kind === 'weekly' && digestCarouselEnabled('weekly')) {
    return buildWeeklyDigestCarouselPngs(anchor, opts);
  }
  if (kind === 'monthly') {
    return [await buildMonthlyDigestCardPng(anchor, opts)];
  }
  if (kind === 'weekly') {
    return [await buildWeeklyDigestCardPng(anchor, opts)];
  }
  return [];
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
  paintDigestMgWatermark(ctx, mgImg);
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
    buildWeeklyAvgXpDigestPng(anchor, DIGEST_CHART_OPTS).catch(err => {
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
  paintDigestMgWatermark(ctx, mgImg);
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
    buildPast30DaysDigestPng(anchor, 30, DIGEST_CHART_OPTS).catch(err => {
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
  paintDigestMgWatermark(ctx, mgImg);
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
  buildDigestMediaPngs,
  buildMonthlyDigestCarouselPngs,
  buildWeeklyDigestCarouselPngs,
  digestCarouselEnabled,
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
