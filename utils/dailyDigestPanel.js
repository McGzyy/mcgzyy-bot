'use strict';

const { createCanvas } = require('canvas');
const {
  TEXT,
  MUTED,
  DIM,
  drawPanel,
  fitFontSize,
  truncate,
  channelAccent
} = require('./xCardRenderHelpers');
const {
  paintCardBackground,
  paintMgWatermark,
  drawSoftGlow,
  CARD_WIDTH,
  CARD_HEIGHT
} = require('./xMilestoneDataCard');
const { loadMgMarkImage } = require('./xBrandAssets');
const {
  getUtcYesterdayAndPriorDeskAvgs,
  getCallerLeaderboardInTimeframe,
  getBestCallInTimeframe,
  getBestBotCallInTimeframe
} = require('./callerStatsService');

const W = CARD_WIDTH;
const H = CARD_HEIGHT;
const PAD = 52;
const MEMBER_AVG_GOOD_AT = 2;

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
 * @param {number|null|undefined} mX
 * @param {number|null|undefined} bX
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
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {string} label
 * @param {string} sub
 * @param {string} hero
 * @param {string} heroColor
 * @param {string} foot
 * @param {string} accent
 */
function drawMetricPanel(ctx, x, y, w, h, label, sub, hero, heroColor, foot, accent) {
  drawPanel(ctx, x, y, w, h, 20, 'rgba(255,255,255,0.035)', 'rgba(255,255,255,0.1)');
  drawSoftGlow(ctx, x + w * 0.5, y + h * 0.42, w * 0.45, accent.soft);

  const cx = x + w / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = MUTED;
  ctx.font = '600 13px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(label, cx, y + 16);
  ctx.font = '500 12px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(sub, cx, y + 34);

  const maxTextW = w - 36;
  const heroSize = fitFontSize(ctx, hero, maxTextW, Math.min(96, h * 0.38), 36, '800');
  ctx.fillStyle = heroColor;
  ctx.font = `800 ${heroSize}px system-ui, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(hero, cx, y + h * 0.48);

  ctx.textBaseline = 'top';
  ctx.font = '600 15px system-ui, "Segoe UI", sans-serif';
  ctx.fillStyle = foot === '—' ? DIM : TEXT;
  ctx.fillText(foot, cx, y + h - 28);
}

/**
 * @param {object|null} call
 */
function formatHighlight(call) {
  if (!call || !call.ticker) return '—';
  const raw = String(call.ticker || call.tokenName || '')
    .trim()
    .replace(/^\$+/u, '');
  const t = raw.length > 14 ? `${raw.slice(0, 12)}…` : raw;
  const x = Number(call.x) || 0;
  return `${t.toUpperCase()} · ${x.toFixed(2)}×`;
}

/**
 * Elite daily digest card (1200×820) — same shell as milestone data cards.
 * @param {Date} [anchor]
 * @returns {Promise<Buffer>}
 */
async function buildDailyDigestCardPng(anchor = new Date()) {
  const accent = channelAccent('member');
  const glow = accent.soft;
  const { yesterday, prior, yesterdayLabel } = getUtcYesterdayAndPriorDeskAvgs(anchor);
  const rows = getCallerLeaderboardInTimeframe(1, 4);
  const bestHuman = getBestCallInTimeframe(1);
  const bestBot = getBestBotCallInTimeframe(1);

  const mY = yesterday.memberAvgX;
  const bY = yesterday.botAvgX;
  const mP = prior.memberAvgX;
  const dod = fmtDayOverDay(mP, mY);
  const spread = fmtMemberBotSpread(mY, bY);

  const mOk = mY != null && Number.isFinite(Number(mY));
  const memberHero = mOk ? `${Number(mY).toFixed(2)}× avg` : '—';
  const memberColor =
    !mOk ? DIM : Number(mY) >= MEMBER_AVG_GOOD_AT ? '#22c55e' : '#ef4444';
  const spreadColor =
    spread.memberAhead == null ? DIM : spread.memberAhead ? '#22c55e' : '#ef4444';
  const spreadSub =
    spread.memberAhead == null
      ? 'Need member & bot averages'
      : spread.memberAhead
        ? 'Members ahead of bot'
        : 'Bot ahead of members';

  const mgImg = await loadMgMarkImage();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  paintCardBackground(ctx, W, H, glow, accent.primary);
  paintMgWatermark(ctx, mgImg, W, H);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = DIM;
  ctx.font = '600 14px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('▲ McGBot Terminal', PAD, PAD);

  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED;
  ctx.font = '600 14px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(`UTC ${yesterdayLabel}`, W - PAD, PAD);

  ctx.textAlign = 'left';
  ctx.fillStyle = accent.primary;
  const titleSize = fitFontSize(ctx, 'Daily snapshot', W - PAD * 2, 56, 36, '800');
  ctx.font = `800 ${titleSize}px system-ui, "Segoe UI", sans-serif`;
  ctx.fillText('Daily snapshot', PAD, PAD + 28);

  const statsY = PAD + 28 + titleSize + 24;
  const statsH = 200;
  const gap = 22;
  const panelW = (W - PAD * 2 - gap) / 2;

  drawMetricPanel(
    ctx,
    PAD,
    statsY,
    panelW,
    statsH,
    'Member desk',
    'Avg ATH × · last UTC day',
    memberHero,
    memberColor,
    dod,
    accent
  );
  drawMetricPanel(
    ctx,
    PAD + panelW + gap,
    statsY,
    panelW,
    statsH,
    'Member vs McGBot',
    'Avg ATH × spread · same day',
    spread.line,
    spreadColor,
    spreadSub,
    accent
  );

  const lbY = statsY + statsH + 24;
  const lbH = 200;
  drawPanel(ctx, PAD, lbY, W - PAD * 2, lbH, 20);
  drawSoftGlow(ctx, PAD + 120, lbY + lbH * 0.4, 160, glow);

  ctx.textAlign = 'left';
  ctx.fillStyle = accent.primary;
  ctx.font = '700 18px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('Caller leaderboard', PAD + 20, lbY + 16);
  ctx.fillStyle = MUTED;
  ctx.font = '500 13px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('Top 4 by avg ATH × · rolling 24h', PAD + 20, lbY + 40);

  const rowStart = lbY + 68;
  const rowH = 28;
  ctx.font = '600 16px system-ui, "Segoe UI", sans-serif';
  if (rows.length) {
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const y = rowStart + i * rowH;
      ctx.fillStyle = i === 0 ? accent.primary : MUTED;
      ctx.fillText(`${i + 1}.`, PAD + 20, y);
      ctx.fillStyle = TEXT;
      ctx.fillText(truncate(r.username, 18), PAD + 48, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = accent.primary;
      ctx.fillText(`${r.avgX.toFixed(2)}× avg`, W - PAD - 140, y);
      ctx.fillStyle = DIM;
      ctx.font = '500 14px system-ui, "Segoe UI", sans-serif';
      ctx.fillText(
        `${r.totalCalls} call${r.totalCalls === 1 ? '' : 's'}`,
        W - PAD - 20,
        y
      );
      ctx.textAlign = 'left';
      ctx.font = '600 16px system-ui, "Segoe UI", sans-serif';
    }
  } else {
    ctx.fillStyle = DIM;
    ctx.fillText('Quiet day — no qualifying desk calls', PAD + 20, rowStart);
  }

  const hiY = lbY + lbH + 22;
  const hiH = 88;
  const hiW = (W - PAD * 2 - gap) / 2;
  drawPanel(ctx, PAD, hiY, hiW, hiH, 16);
  drawPanel(ctx, PAD + hiW + gap, hiY, hiW, hiH, 16);

  ctx.fillStyle = MUTED;
  ctx.font = '600 12px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('Best member call', PAD + 16, hiY + 14);
  ctx.fillText('Best McGBot call', PAD + hiW + gap + 16, hiY + 14);

  ctx.fillStyle = TEXT;
  const hiSize = fitFontSize(ctx, formatHighlight(bestHuman), hiW - 32, 28, 18, '700');
  ctx.font = `700 ${hiSize}px system-ui, "Segoe UI", sans-serif`;
  ctx.fillText(formatHighlight(bestHuman), PAD + 16, hiY + 38);
  ctx.fillText(formatHighlight(bestBot), PAD + hiW + gap + 16, hiY + 38);

  const footerY = H - PAD - 8;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = MUTED;
  ctx.font = '600 15px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('🔹 Dashboard link in bio', PAD, footerY);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(180, 180, 192, 0.98)';
  ctx.font = '700 17px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('mcgbot.xyz', W - PAD, footerY);

  return canvas.toBuffer('image/png');
}

/** @deprecated use buildDailyDigestCardPng */
async function buildDailySnapshotModulesPng(anchor = new Date()) {
  return buildDailyDigestCardPng(anchor);
}

module.exports = {
  buildDailyDigestCardPng,
  buildDailySnapshotModulesPng
};
