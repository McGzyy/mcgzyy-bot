'use strict';

const { createCanvas } = require('canvas');
const {
  TEXT,
  MUTED,
  DIM,
  drawPanel,
  fitFontSize,
  truncate,
  channelAccent,
  roundRectPath
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
    dateLabel,
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
    dateLabel: yesterdayLabel,
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
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {string} text
 * @param {string} color
 */
function drawPreviewBadge(ctx, x, y, text, color) {
  ctx.font = '700 11px system-ui, "Segoe UI", sans-serif';
  const tw = ctx.measureText(text).width;
  const bw = tw + 20;
  const bh = 24;
  roundRectPath(ctx, x - bw, y, bw, bh, 8);
  ctx.fillStyle = color + '22';
  ctx.fill();
  ctx.strokeStyle = color + '99';
  ctx.lineWidth = 1;
  roundRectPath(ctx, x - bw, y, bw, bh, 8);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x - 10, y + bh / 2);
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} rank
 * @param {string} accent
 */
function drawRankBadge(ctx, cx, cy, rank, accent) {
  const colors = ['#fbbf24', '#d4d4d8', '#d97706'];
  const fill = rank <= 3 ? colors[rank - 1] : 'rgba(255,255,255,0.12)';
  const r = 14;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (rank > 3) {
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = rank <= 3 ? '#0a0a0f' : MUTED;
  ctx.font = '800 13px system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(rank), cx, cy + 1);
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {{ label: string, sub: string, heroNum: string, heroSuffix: string, heroColor: string, foot: string }} p
 * @param {{ primary: string, soft: string }} accent
 */
function drawMetricPanel(ctx, x, y, w, h, p, accent) {
  drawPanel(ctx, x, y, w, h, 20, 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0.11)');
  drawSoftGlow(ctx, x + w * 0.35, y + h * 0.55, w * 0.5, accent.soft);

  const innerX = x + 22;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = MUTED;
  ctx.font = '600 13px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(p.label, innerX, y + 16);
  ctx.font = '500 12px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(p.sub, innerX, y + 34);

  const heroY = y + h * 0.46;
  const maxHeroW = w - 44;
  const numSize = fitFontSize(ctx, p.heroNum, maxHeroW * 0.72, Math.min(88, h * 0.34), 40, '800');
  ctx.fillStyle = p.heroColor;
  ctx.font = `800 ${numSize}px system-ui, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  const numW = ctx.measureText(p.heroNum).width;
  ctx.fillText(p.heroNum, innerX, heroY);

  const sufSize = Math.max(18, Math.round(numSize * 0.34));
  ctx.font = `600 ${sufSize}px system-ui, "Segoe UI", sans-serif`;
  ctx.fillStyle = MUTED;
  ctx.globalAlpha = 0.9;
  ctx.fillText(p.heroSuffix, innerX + numW + 10, heroY + numSize * 0.08);
  ctx.globalAlpha = 1;

  ctx.textBaseline = 'top';
  ctx.font = '600 14px system-ui, "Segoe UI", sans-serif';
  ctx.fillStyle = p.foot === '—' ? DIM : TEXT;
  ctx.fillText(p.foot, innerX, y + h - 30);
}

/**
 * @param {{ ticker: string, x: number }|null} call
 */
function formatHighlight(call) {
  if (!call || !call.ticker) return { line: '—', sub: 'No qualifying call' };
  const raw = String(call.ticker || '')
    .trim()
    .replace(/^\$+/u, '');
  const t = raw.length > 12 ? `${raw.slice(0, 10)}…` : raw;
  const x = Number(call.x) || 0;
  return { line: t.toUpperCase(), sub: `${x.toFixed(2)}× ATH` };
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {import('./dailyDigestPanel').DailyDigestData} data
 * @param {{ primary: string, soft: string, grad: string[] }} accent
 */
function renderDailyDigestCard(ctx, data, accent) {
  const glow = accent.soft;
  const mY = data.memberAvgX;
  const bY = data.botAvgX;
  const mP = data.priorMemberAvgX;
  const dod = fmtDayOverDay(mP, mY);
  const spread = fmtMemberBotSpread(mY, bY);

  const mOk = mY != null && Number.isFinite(mY);
  const memberNum = mOk ? `${Number(mY).toFixed(2)}×` : '—';
  const memberColor =
    !mOk ? DIM : Number(mY) >= MEMBER_AVG_GOOD_AT ? '#22c55e' : '#ef4444';

  const spreadColor =
    spread.memberAhead == null ? DIM : spread.memberAhead ? '#22c55e' : '#ef4444';

  const titleY = PAD + 30;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = DIM;
  ctx.font = '600 14px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('▲ McGBot Terminal', PAD, PAD);

  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED;
  ctx.fillText(`UTC ${data.dateLabel}`, W - PAD, PAD);
  if (data.isSample) {
    drawPreviewBadge(ctx, W - PAD, PAD + 22, 'LAYOUT PREVIEW', accent.primary);
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = accent.primary;
  const titleSize = fitFontSize(ctx, 'Daily snapshot', W - PAD * 2, 54, 38, '800');
  ctx.font = `800 ${titleSize}px system-ui, "Segoe UI", sans-serif`;
  ctx.fillText('Daily snapshot', PAD, titleY);

  const ruleW = Math.min(160, ctx.measureText('Daily snapshot').width);
  ctx.fillStyle = accent.primary;
  ctx.fillRect(PAD, titleY + titleSize + 10, ruleW, 3);

  const statsY = titleY + titleSize + 28;
  const statsH = 188;
  const gap = 20;
  const panelW = (W - PAD * 2 - gap) / 2;

  drawMetricPanel(
    ctx,
    PAD,
    statsY,
    panelW,
    statsH,
    {
      label: 'Member desk',
      sub: 'Avg ATH × · last UTC day',
      heroNum: memberNum,
      heroSuffix: 'avg',
      heroColor: memberColor,
      foot: dod
    },
    accent
  );
  drawMetricPanel(
    ctx,
    PAD + panelW + gap,
    statsY,
    panelW,
    statsH,
    {
      label: 'Member vs McGBot',
      sub: 'Spread on avg ATH ×',
      heroNum: spread.line,
      heroSuffix: 'spread',
      heroColor: spreadColor,
      foot: spread.foot
    },
    accent
  );

  const lbY = statsY + statsH + 20;
  const lbH = 228;
  drawPanel(ctx, PAD, lbY, W - PAD * 2, lbH, 20);
  drawSoftGlow(ctx, PAD + 200, lbY + 90, 220, glow);

  ctx.textAlign = 'left';
  ctx.fillStyle = accent.primary;
  ctx.font = '700 20px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('Caller leaderboard', PAD + 22, lbY + 18);
  ctx.fillStyle = MUTED;
  ctx.font = '500 13px system-ui, "Segoe UI", sans-serif';
  ctx.fillText('Top 4 by avg ATH × · rolling 24h', PAD + 22, lbY + 44);

  const rows = data.leaderboard || [];
  const rowStart = lbY + 72;
  const rowH = 36;
  if (rows.length) {
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const y = rowStart + i * rowH;
      const rankCx = PAD + 38;
      const rankCy = y + rowH / 2;
      drawRankBadge(ctx, rankCx, rankCy, i + 1, accent.primary);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = TEXT;
      ctx.font = '700 17px system-ui, "Segoe UI", sans-serif';
      ctx.fillText(truncate(r.username, 16), PAD + 62, rankCy);

      ctx.textAlign = 'right';
      ctx.fillStyle = accent.primary;
      ctx.font = '800 18px system-ui, "Segoe UI", sans-serif';
      ctx.fillText(`${Number(r.avgX).toFixed(2)}×`, W - PAD - 120, rankCy - 1);
      ctx.fillStyle = DIM;
      ctx.font = '500 14px system-ui, "Segoe UI", sans-serif';
      ctx.fillText(
        `${r.totalCalls} call${r.totalCalls === 1 ? '' : 's'}`,
        W - PAD - 22,
        rankCy
      );

      if (i < rows.length - 1) {
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD + 22, y + rowH);
        ctx.lineTo(W - PAD - 22, y + rowH);
        ctx.stroke();
      }
    }
  } else {
    ctx.fillStyle = DIM;
    ctx.font = '600 15px system-ui, "Segoe UI", sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText('Quiet day — no qualifying desk calls', PAD + 22, rowStart + 8);
  }

  const hiY = lbY + lbH + 18;
  const hiH = 96;
  const hiW = (W - PAD * 2 - gap) / 2;
  const botAccent = channelAccent('bot');

  /**
   * @param {number} px
   * @param {{ line: string, sub: string }} hi
   * @param {{ primary: string }} col
   */
  function drawHighlight(px, hi, col) {
    drawPanel(ctx, px, hiY, hiW, hiH, 16);
    ctx.fillStyle = col.primary;
    ctx.fillRect(px, hiY + 12, 4, hiH - 24);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = MUTED;
    ctx.font = '600 12px system-ui, "Segoe UI", sans-serif';
    const label = px === PAD ? 'Best member call' : 'Best McGBot call';
    ctx.fillText(label, px + 18, hiY + 14);
    ctx.fillStyle = TEXT;
    const lineSize = fitFontSize(ctx, hi.line, hiW - 36, 32, 20, '800');
    ctx.font = `800 ${lineSize}px system-ui, "Segoe UI", sans-serif`;
    ctx.fillText(hi.line, px + 18, hiY + 36);
    ctx.fillStyle = col.primary;
    ctx.font = '700 16px system-ui, "Segoe UI", sans-serif';
    ctx.fillText(hi.sub, px + 18, hiY + 36 + lineSize + 6);
  }

  drawHighlight(PAD, formatHighlight(data.bestHuman), accent);
  drawHighlight(PAD + hiW + gap, formatHighlight(data.bestBot), botAccent);

  const footerY = H - PAD - 6;
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
  const mgImg = await loadMgMarkImage();

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  paintCardBackground(ctx, W, H, glow, accent.primary);
  paintMgWatermark(ctx, mgImg, W, H);
  renderDailyDigestCard(ctx, data, accent);

  return canvas.toBuffer('image/png');
}

/** @deprecated use buildDailyDigestCardPng */
async function buildDailySnapshotModulesPng(anchor = new Date()) {
  return buildDailyDigestCardPng(anchor);
}

module.exports = {
  buildDailyDigestCardPng,
  buildDailySnapshotModulesPng,
  buildSampleDailyDigestData,
  buildLiveDailyDigestData,
  resolveDailyDigestData
};
