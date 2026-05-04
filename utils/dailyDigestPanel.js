'use strict';

const { createCanvas } = require('canvas');
const { getUtcYesterdayAndPriorDeskAvgs } = require('./callerStatsService');

const W = 960;
const H = 420;
const BG = '#000000';
const PANEL = '#0a0a0a';
const BORDER = 'rgba(255, 255, 255, 0.12)';
const TEXT = '#fafafa';
const MUTED = 'rgba(161, 161, 170, 0.95)';
const COBALT = '#1a7cff';
const GREEN = '#22c55e';
const RADIUS = 18;

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

  const pad = 24;
  const gap = 20;
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
  const spreadColor =
    spread.memberAhead == null ? MUTED : spread.memberAhead ? COBALT : GREEN;

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

  /* Left: member desk avg + change */
  const cxL = xL + panelW / 2;
  let y = y0 + 36;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = MUTED;
  ctx.font = '600 11px system-ui, Segoe UI, sans-serif';
  ctx.fillText('Member desk', cxL, y);
  y += 18;
  ctx.font = '500 11px system-ui, Segoe UI, sans-serif';
  ctx.fillText(yesterdayLabel, cxL, y);
  y += 36;

  ctx.font = '800 44px system-ui, Segoe UI, sans-serif';
  ctx.fillStyle = COBALT;
  const hero =
    mY != null && Number.isFinite(Number(mY))
      ? `${Number(mY).toFixed(2)}× avg`
      : '—';
  ctx.fillText(hero, cxL, y);
  y += 56;

  ctx.font = '600 15px system-ui, Segoe UI, sans-serif';
  ctx.fillStyle = dod === '—' ? MUTED : TEXT;
  ctx.fillText(dod, cxL, y);

  /* Right: member vs bot spread */
  const cxR = xR + panelW / 2;
  y = y0 + 36;
  ctx.fillStyle = MUTED;
  ctx.font = '600 11px system-ui, Segoe UI, sans-serif';
  ctx.fillText('Member vs McGBot', cxR, y);
  y += 18;
  ctx.font = '500 11px system-ui, Segoe UI, sans-serif';
  ctx.fillText('Avg ATH × spread · same day', cxR, y);
  y += 40;

  ctx.font = '800 44px system-ui, Segoe UI, sans-serif';
  ctx.fillStyle = spreadColor;
  ctx.fillText(spread.line, cxR, y);
  y += 52;

  ctx.font = '500 12px system-ui, Segoe UI, sans-serif';
  ctx.fillStyle = MUTED;
  const sub =
    spread.memberAhead == null
      ? 'Need member & bot averages'
      : spread.memberAhead
        ? 'Members ahead of bot for the day'
        : 'Bot ahead of members for the day';
  ctx.fillText(sub, cxR, y);

  return canvas.toBuffer('image/png');
}

module.exports = {
  buildDailySnapshotModulesPng
};
