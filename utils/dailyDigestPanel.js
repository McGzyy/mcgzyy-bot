'use strict';

const { createCanvas } = require('canvas');
const {
  TEXT,
  MUTED,
  DIM,
  fitFontSize,
  truncate,
  channelAccent,
  roundRectPath
} = require('./xCardRenderHelpers');
const {
  paintCardBackground,
  paintMgWatermark,
  drawSoftGlow,
  drawMultiplier,
  CARD_WIDTH,
  CARD_HEIGHT
} = require('./xMilestoneDataCard');
const { loadMgMarkImage, loadMcGBotAvatarImage } = require('./xBrandAssets');
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
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {{ label: string, sub: string, hero: string, grad: string[], foot: string }} p
 * @param {{ primary: string, soft: string, grad: string[] }} accent
 */
function drawHeroMetricPanel(ctx, x, y, w, h, p, accent) {
  drawGlassPanel(ctx, x, y, w, h, 22, accent);
  drawSoftGlow(ctx, x + w - 80, y + h - 50, Math.min(w * 0.55, 200), accent.soft);

  const inner = x + 24;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = accent.primary;
  ctx.font = '700 14px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(p.label.toUpperCase(), inner, y + 18);
  ctx.fillStyle = MUTED;
  ctx.font = '500 12px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(p.sub, inner, y + 38);

  const heroSize = fitFontSize(ctx, p.hero, w - 48, Math.min(96, h * 0.42), 44, '800');
  const heroBase = y + h - 36;
  drawMultiplier(ctx, p.hero, x + w - 24, heroBase, heroSize, p.grad, accent.primary);

  ctx.font = '600 14px system-ui, "Segoe UI", sans-serif';
  ctx.fillStyle = p.foot === '—' ? DIM : 'rgba(220, 220, 228, 0.95)';
  ctx.fillText(p.foot, inner, y + h - 32);
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
 * @param {{ primary: string, soft: string, grad: string[] }} accent
 * @param {import('canvas').Image|null} botAvatar
 */
function renderDailyDigestCard(ctx, data, accent, botAvatar) {
  const mY = data.memberAvgX;
  const bY = data.botAvgX;
  const mP = data.priorMemberAvgX;
  const dod = fmtDayOverDay(mP, mY);
  const spread = fmtMemberBotSpread(mY, bY);
  const botAccent = channelAccent('bot');

  const mOk = mY != null && Number.isFinite(mY);
  const memberHero = mOk ? `${Number(mY).toFixed(2)}×` : '—';
  const memberGood = !mOk ? null : Number(mY) >= MEMBER_AVG_GOOD_AT;
  const spreadGood = spread.memberAhead;

  const headerH = 108;
  drawTitleGradient(ctx, 'Daily snapshot', PAD, PAD + 18, 52, accent.grad);
  ctx.fillStyle = accent.primary;
  ctx.font = '700 12px system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('TERMINAL · DESK PERFORMANCE', PAD, PAD);

  drawDateChip(ctx, W - PAD, PAD + 4, `UTC ${data.dateLabel}`, accent.primary);
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
      sub: 'Avg ATH × · last UTC day',
      hero: memberHero,
      grad: metricGrad(memberGood),
      foot: dod
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
  ctx.fillText('Top 4 · avg ATH × · rolling 24h', PAD + 24, bodyY + 48);

  const rows = data.leaderboard || [];
  const rowStart = bodyY + 78;
  const rowH = Math.min(44, Math.floor((bodyH - 90) / Math.max(4, rows.length || 1)));

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
      ctx.font = `700 ${i === 0 ? 19 : 17}px system-ui, "Segoe UI", sans-serif`;
      ctx.fillText(truncate(r.username, 14), rowPad + 44, rankCy);

      const multStr = `${Number(r.avgX).toFixed(2)}×`;
      const multSize = fitFontSize(ctx, multStr, 120, i === 0 ? 26 : 22, 16, '800');
      if (i === 0) {
        drawMultiplier(
          ctx,
          multStr,
          PAD + lbW - 28,
          rankCy + multSize * 0.35,
          multSize,
          accent.grad,
          accent.primary
        );
      } else {
        ctx.textAlign = 'right';
        ctx.fillStyle = accent.primary;
        ctx.font = `800 ${multSize}px system-ui, "Segoe UI", sans-serif`;
        ctx.fillText(multStr, PAD + lbW - 28, rankCy);
      }

      ctx.textAlign = 'right';
      ctx.fillStyle = DIM;
      ctx.font = '500 13px system-ui, "Segoe UI", sans-serif';
      ctx.fillText(
        `${r.totalCalls} call${r.totalCalls === 1 ? '' : 's'}`,
        PAD + lbW - 100,
        rankCy
      );
    }
  } else {
    ctx.fillStyle = DIM;
    ctx.font = '600 15px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Quiet day — no qualifying desk calls', PAD + 24, rowStart + 12);
  }

  const sideX = PAD + lbW + colGap;
  const hiGap = 16;
  const hiH = Math.floor((bodyH - hiGap) / 2);
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
    drawSoftGlow(ctx, sideX + sideW - 40, hy + hiH * 0.55, 120, col.soft);

    if (avatar) {
      const av = 52;
      const ax = sideX + sideW - av - 18;
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
    ctx.fillText(label.toUpperCase(), sideX + 20, hy + 16);

    if (!hi) {
      ctx.fillStyle = DIM;
      ctx.font = '600 16px system-ui, "Segoe UI", sans-serif';
      ctx.fillText('—', sideX + 20, hy + 44);
      return;
    }

    ctx.fillStyle = TEXT;
    const tickSize = fitFontSize(ctx, hi.ticker, sideW - 100, 34, 22, '800');
    ctx.font = `800 ${tickSize}px system-ui, "Segoe UI", sans-serif`;
    ctx.fillText(hi.ticker, sideX + 20, hy + 38);

    const multSize = fitFontSize(ctx, hi.mult, sideW - 48, 56, 32, '800');
    drawMultiplier(
      ctx,
      hi.mult,
      sideX + sideW - 20,
      hy + hiH - 22,
      multSize,
      col.grad,
      col.primary
    );
  }

  drawHighlightCard(bodyY, 'Best member call', hiHuman, accent, null);
  drawHighlightCard(bodyY + hiH + hiGap, 'Best McGBot call', hiBot, botAccent, botAvatar);

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
  renderDailyDigestCard(ctx, data, accent, botAvatar);

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
