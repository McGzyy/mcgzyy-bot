'use strict';

const { createCanvas } = require('canvas');
const { getUtcYesterdayAndPriorDeskAvgs } = require('./callerStatsService');

const W = 960;
const H = 460;
const BG = '#000000';
const PANEL = '#0a0a0a';
const BORDER = 'rgba(255, 255, 255, 0.12)';
const TEXT = '#fafafa';
const MUTED = 'rgba(161, 161, 170, 0.95)';
const GREEN = '#22c55e';
const RED = '#ef4444';
const RADIUS = 18;
/** Member desk hero: at or above this avg ATH × → green, else red. */
const MEMBER_AVG_GOOD_AT = 2;

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rr);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
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
 * Member avg minus McGBot avg (yesterday UTC). Positive = members ahead.
 * @param {number|null|undefined} mX
 * @param {number|null|undefined} bX
 * @returns {{ line: string, memberAhead: boolean|null }}
 */
function fmtMemberBotSpread(mX, bX) {
  if (mX == null || bX == null || !Number.isFinite(mX) || !Number.isFinite(bX)) {
    return { line: '—', memberAhead: null };
  }
  const d = mX - bX;
  const sign = d > 0 ? '+' : '';
  return { line: `${sign}${d.toFixed(2)}×`, memberAhead: d >= 0 };
}

/**
 * Pick largest font size so text fits maxWidth (bold weight).
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @param {number} maxSize
 * @param {number} minSize
 */
function fitFontSize(ctx, text, maxWidth, maxSize, minSize) {
  for (let s = maxSize; s >= minSize; s -= 2) {
    ctx.font = `800 ${s}px system-ui, "Segoe UI", sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) {
      return s;
    }
  }
  return minSize;
}

/**
 * Two rounded cards: (1) member desk avg for last completed UTC day + day-over-day change,
 * (2) member vs McGBot avg spread for that day.
 * @param {Date} [anchor]
 * @returns {Promise<Buffer>}
 */
async function buildDailySnapshotModulesPng(anchor = new Date()) {
  const { yesterday, prior, yesterdayLabel } = getUtcYesterdayAndPriorDeskAvgs(anchor);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  const pad = 22;
  const gap = 18;
  const panelW = (W - pad * 2 - gap) / 2;
  const panelH = H - pad * 2;
  const y0 = pad;
  const xL = pad;
  const xR = pad + panelW + gap;

  const mY = yesterday.memberAvgX;
  const bY = yesterday.botAvgX;
  const mP = prior.memberAvgX;

  const dod = fmtDayOverDay(mP, mY);
  const spread = fmtMemberBotSpread(mY, bY);

  const mOk = mY != null && Number.isFinite(Number(mY));
  const memberHeroColor = !mOk ? MUTED : Number(mY) >= MEMBER_AVG_GOOD_AT ? GREEN : RED;
  const spreadColor =
    spread.memberAhead == null ? MUTED : spread.memberAhead ? GREEN : RED;

  /**
   * @param {number} px
   */
  function drawCard(px) {
    ctx.fillStyle = PANEL;
    roundRectPath(ctx, px, y0, panelW, panelH, RADIUS);
    ctx.fill();
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    roundRectPath(ctx, px, y0, panelW, panelH, RADIUS);
    ctx.stroke();
  }

  drawCard(xL);
  drawCard(xR);

  const cxL = xL + panelW / 2;
  const cxR = xR + panelW / 2;
  const maxTextW = panelW - 28;
  const headerTop = y0 + 14;

  /* Left: compact header, dominant hero, sub */
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = MUTED;
  ctx.font = '600 10px system-ui, Segoe UI, sans-serif';
  ctx.fillText('Member desk', cxL, headerTop);
  ctx.font = '500 10px system-ui, Segoe UI, sans-serif';
  ctx.fillText(yesterdayLabel, cxL, headerTop + 14);

  const hero =
    mOk ? `${Number(mY).toFixed(2)}× avg` : '—';
  const heroMaxByHeight = Math.floor((panelH - 72) * 0.52);
  const heroSize = fitFontSize(ctx, hero, maxTextW, Math.min(108, heroMaxByHeight), 40);
  ctx.font = `800 ${heroSize}px system-ui, Segoe UI, sans-serif`;
  const heroMetrics = ctx.measureText(hero);
  const heroH = heroMetrics.actualBoundingBoxAscent + heroMetrics.actualBoundingBoxDescent || heroSize * 1.05;

  const blockTop = headerTop + 34;
  const blockBottom = y0 + panelH - 22;
  const heroCenterY = blockTop + (blockBottom - blockTop) / 2;
  ctx.fillStyle = memberHeroColor;
  ctx.textBaseline = 'middle';
  ctx.fillText(hero, cxL, heroCenterY - heroH * 0.05);

  ctx.textBaseline = 'top';
  ctx.font = '600 14px system-ui, Segoe UI, sans-serif';
  ctx.fillStyle = dod === '—' ? MUTED : TEXT;
  ctx.fillText(dod, cxL, blockBottom - 20);

  /* Right: member vs bot spread */
  ctx.fillStyle = MUTED;
  ctx.font = '600 10px system-ui, Segoe UI, sans-serif';
  ctx.fillText('Member vs McGBot', cxR, headerTop);
  ctx.font = '500 10px system-ui, Segoe UI, sans-serif';
  ctx.fillText('Avg ATH × spread · same day', cxR, headerTop + 14);

  const spreadMaxByHeight = Math.floor((panelH - 72) * 0.52);
  const spreadSize = fitFontSize(ctx, spread.line, maxTextW, Math.min(108, spreadMaxByHeight), 40);
  ctx.font = `800 ${spreadSize}px system-ui, Segoe UI, sans-serif`;
  const sm = ctx.measureText(spread.line);
  const spreadH = sm.actualBoundingBoxAscent + sm.actualBoundingBoxDescent || spreadSize * 1.05;

  ctx.fillStyle = spreadColor;
  ctx.textBaseline = 'middle';
  ctx.fillText(spread.line, cxR, heroCenterY - spreadH * 0.05);

  ctx.textBaseline = 'top';
  ctx.font = '500 12px system-ui, Segoe UI, sans-serif';
  ctx.fillStyle = MUTED;
  const sub =
    spread.memberAhead == null
      ? 'Need member & bot averages'
      : spread.memberAhead
        ? 'Members ahead of bot for the day'
        : 'Bot ahead of members for the day';
  ctx.fillText(sub, cxR, blockBottom - 20);

  return canvas.toBuffer('image/png');
}

module.exports = {
  buildDailySnapshotModulesPng
};
