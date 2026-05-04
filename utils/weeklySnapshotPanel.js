'use strict';

const { createCanvas } = require('canvas');
const { getUtcYesterdayAndPriorDeskAvgs } = require('./callerStatsService');

const W = 960;
const H = 440;
const BG = '#000000';
const PANEL = '#0a0a0a';
const BORDER = 'rgba(255, 255, 255, 0.14)';
const TEXT = '#fafafa';
const MUTED = 'rgba(161, 161, 170, 0.92)';
const COBALT = '#1a7cff';
const GREEN = '#22c55e';

/**
 * @param {number|null|undefined} v
 */
function fmtX(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `${Number(v).toFixed(2)}×`;
}

/**
 * @param {number|null|undefined} prev
 * @param {number|null|undefined} cur
 */
function fmtDelta(prev, cur) {
  if (prev == null || cur == null || !Number.isFinite(prev) || !Number.isFinite(cur)) {
    return '—';
  }
  const d = cur - prev;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(2)}×`;
}

/**
 * Dual-module PNG for the weekly X stats snapshot: DoD desk avg × + yesterday member vs bot.
 * @param {Date} [anchor]
 * @returns {Promise<Buffer>}
 */
async function buildWeeklySnapshotModulesPng(anchor = new Date()) {
  const { yesterday, prior, yesterdayLabel, priorLabel } = getUtcYesterdayAndPriorDeskAvgs(anchor);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  const pad = 26;
  const gap = 18;
  const panelW = (W - pad * 2 - gap) / 2;
  const panelH = H - pad * 2;
  const y0 = pad;

  /**
   * @param {number} px
   * @param {string} title
   */
  function drawPanelFrame(px, title) {
    ctx.fillStyle = PANEL;
    ctx.fillRect(px, y0, panelW, panelH);
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, y0 + 0.5, panelW - 1, panelH - 1);
    ctx.fillStyle = MUTED;
    ctx.font = '600 11px system-ui,Segoe UI,sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(title, px + 18, y0 + 16);
  }

  const xL = pad;
  const xR = pad + panelW + gap;
  drawPanelFrame(xL, 'DAY VS PRIOR DAY (UTC)');
  drawPanelFrame(xR, 'YESTERDAY — MEMBER VS BOT');

  const innerL = xL + 18;
  const innerR = xR + 18;
  let y = y0 + 44;

  ctx.font = '500 12px system-ui,Segoe UI,sans-serif';
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'left';
  ctx.fillText(`${priorLabel}  →  ${yesterdayLabel}`, innerL, y);
  y += 26;

  ctx.font = '600 13px system-ui,Segoe UI,sans-serif';
  ctx.fillStyle = TEXT;
  ctx.fillText('Member desk — avg ATH ×', innerL, y);
  y += 22;
  ctx.font = '500 15px system-ui,Segoe UI,sans-serif';
  ctx.fillStyle = COBALT;
  ctx.fillText(
    `${fmtX(prior.memberAvgX)}  →  ${fmtX(yesterday.memberAvgX)}`,
    innerL,
    y
  );
  y += 22;
  ctx.font = '600 13px system-ui,Segoe UI,sans-serif';
  ctx.fillStyle = MUTED;
  const md = fmtDelta(prior.memberAvgX, yesterday.memberAvgX);
  ctx.fillText(`Change: ${md}`, innerL, y);
  y += 36;

  ctx.font = '600 13px system-ui,Segoe UI,sans-serif';
  ctx.fillStyle = TEXT;
  ctx.fillText('McGBot desk — avg ATH ×', innerL, y);
  y += 22;
  ctx.font = '500 15px system-ui,Segoe UI,sans-serif';
  ctx.fillStyle = GREEN;
  ctx.fillText(`${fmtX(prior.botAvgX)}  →  ${fmtX(yesterday.botAvgX)}`, innerL, y);
  y += 22;
  ctx.font = '600 13px system-ui,Segoe UI,sans-serif';
  ctx.fillStyle = MUTED;
  ctx.fillText(`Change: ${fmtDelta(prior.botAvgX, yesterday.botAvgX)}`, innerL, y);

  /* Right panel: yesterday comparison */
  let yr = y0 + 52;
  const mX = yesterday.memberAvgX;
  const bX = yesterday.botAvgX;
  const mOk = mX != null && Number.isFinite(Number(mX));
  const bOk = bX != null && Number.isFinite(Number(bX));

  ctx.textAlign = 'left';
  ctx.font = '700 28px system-ui,Segoe UI,sans-serif';
  ctx.fillStyle = COBALT;
  ctx.fillText(mOk ? fmtX(mX) : '—', innerR, yr);
  ctx.font = '500 12px system-ui,Segoe UI,sans-serif';
  ctx.fillStyle = MUTED;
  ctx.fillText(`Member · ${yesterday.memberCount} call${yesterday.memberCount === 1 ? '' : 's'}`, innerR, yr + 36);

  ctx.font = '700 28px system-ui,Segoe UI,sans-serif';
  ctx.fillStyle = GREEN;
  ctx.fillText(bOk ? fmtX(bX) : '—', innerR + panelW * 0.48, yr);
  ctx.font = '500 12px system-ui,Segoe UI,sans-serif';
  ctx.fillStyle = MUTED;
  ctx.fillText(`McGBot · ${yesterday.botCount} call${yesterday.botCount === 1 ? '' : 's'}`, innerR + panelW * 0.48, yr + 36);

  yr += 100;
  const maxBar = Math.max(mOk ? mX : 0, bOk ? bX : 0, 2.2);
  const barW = panelW - 36;
  const barH = 14;
  ctx.font = '500 11px system-ui,Segoe UI,sans-serif';
  ctx.fillStyle = MUTED;
  ctx.fillText('Relative scale (×)', innerR, yr - 4);
  yr += 14;
  if (mOk) {
    const w = Math.max(6, (mX / maxBar) * barW);
    ctx.fillStyle = 'rgba(26, 124, 255, 0.25)';
    ctx.fillRect(innerR, yr, barW, barH);
    ctx.fillStyle = COBALT;
    ctx.fillRect(innerR, yr, w, barH);
    yr += barH + 10;
  }
  if (bOk) {
    const w = Math.max(6, (bX / maxBar) * barW);
    ctx.fillStyle = 'rgba(34, 197, 94, 0.22)';
    ctx.fillRect(innerR, yr, barW, barH);
    ctx.fillStyle = GREEN;
    ctx.fillRect(innerR, yr, w, barH);
  }

  return canvas.toBuffer('image/png');
}

module.exports = {
  buildWeeklySnapshotModulesPng
};
