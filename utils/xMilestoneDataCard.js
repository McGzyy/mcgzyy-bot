'use strict';

const { createCanvas } = require('canvas');
const {
  TEXT,
  MUTED,
  DIM,
  fitFontSize,
  truncate,
  formatUsd,
  formatMultiple,
  loadRemoteImage,
  channelAccent,
  roundRectPath
} = require('./xCardRenderHelpers');
const { loadMgMarkImage } = require('./xBrandAssets');

const W = 1200;
const H = 820;

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {string} accentGlow
 * @param {string} accentPrimary
 */
function paintCardBackground(ctx, w, h, accentGlow, accentPrimary) {
  const base = ctx.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, '#000002');
  base.addColorStop(0.45, '#05050c');
  base.addColorStop(1, '#010104');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  const beam = ctx.createLinearGradient(w * 0.55, 0, w, h * 0.7);
  beam.addColorStop(0, 'rgba(0,0,0,0)');
  beam.addColorStop(0.35, accentGlow);
  beam.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = beam;
  ctx.fillRect(0, 0, w, h);

  const beam2 = ctx.createLinearGradient(0, h * 0.2, w * 0.5, h);
  beam2.addColorStop(0, 'rgba(255,255,255,0.02)');
  beam2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = beam2;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, 16, 16, w - 32, h - 32, 22);
  ctx.stroke();

  ctx.strokeStyle = accentPrimary + '40';
  ctx.lineWidth = 1;
  roundRectPath(ctx, 17, 17, w - 34, h - 34, 21);
  ctx.stroke();
}

/**
 * Large dull MG mark behind the hero (background only).
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {import('canvas').Image|null} mgImg
 * @param {number} w
 * @param {number} h
 */
function paintMgWatermark(ctx, mgImg, w, h) {
  if (!mgImg) return;

  const markW = Math.min(720, w * 0.78);
  const scale = markW / mgImg.width;
  const markH = mgImg.height * scale;
  const mx = w - markW + 40;
  const my = h * 0.02 - markH * 0.08;

  ctx.save();
  const alphaRaw = process.env.X_MILESTONE_MG_WATERMARK_ALPHA;
  ctx.globalAlpha =
    alphaRaw != null && String(alphaRaw).trim() !== ''
      ? Math.min(0.2, Math.max(0.03, Number(alphaRaw)))
      : 0.09;
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(mgImg, mx, my, markW, markH);
  ctx.restore();
}

function drawSoftGlow(ctx, cx, cy, r, color) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

function drawTokenHero(ctx, img, x, y, size, accent, ticker) {
  const r = Math.round(size * 0.1);

  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 42;
  ctx.shadowOffsetY = 16;
  roundRectPath(ctx, x, y, size, size, r);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fill();
  ctx.restore();

  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.save();
  roundRectPath(ctx, x, y, size, size, r);
  ctx.clip();
  if (img) {
    const s = Math.max(size / img.width, size / img.height);
    ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s);
    const shade = ctx.createLinearGradient(x, y, x, y + size);
    shade.addColorStop(0, 'rgba(0,0,0,0.05)');
    shade.addColorStop(0.55, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = shade;
    ctx.fillRect(x, y, size, size);
  } else {
    const bg = ctx.createLinearGradient(x, y, x + size, y + size);
    bg.addColorStop(0, '#1a1a24');
    bg.addColorStop(1, '#0a0a10');
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.font = `800 ${Math.floor(size * 0.22)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((ticker || '?').charAt(0), cx, cy);
  }
  ctx.restore();

  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  roundRectPath(ctx, x, y, size, size, r);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, x + 3, y + 3, size - 6, size - 6, r - 2);
  ctx.stroke();
}

/**
 * Coin age chip — top-right on token, accent-tinted glass (not a heavy black pill).
 */
function drawCoinAgeTag(ctx, ageText, tokenX, tokenY, tokenSize, accent) {
  const raw = String(ageText || '').trim();
  if (!raw) return;

  const short = raw.replace(/\s*old\s*$/i, '').trim() || raw;
  const padX = 12;
  const padY = 10;
  const fontPx = 13;

  ctx.font = `700 ${fontPx}px system-ui, "Segoe UI", sans-serif`;
  const tw = ctx.measureText(short).width;
  const bw = tw + padX * 2;
  const bh = fontPx + padY * 2;
  const x = tokenX + tokenSize - bw - 10;
  const y = tokenY + 10;

  roundRectPath(ctx, x, y, bw, bh, bh / 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fill();
  roundRectPath(ctx, x, y, bw, bh, bh / 2);
  ctx.fillStyle = accent + '30';
  ctx.fill();
  ctx.strokeStyle = accent + 'aa';
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, x, y, bw, bh, bh / 2);
  ctx.stroke();

  ctx.fillStyle = '#f4f4f5';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(short, x + bw / 2, y + bh / 2 + 1);
}

function drawMultiplier(ctx, text, rightX, baselineY, size, grad, accent) {
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `800 ${size}px system-ui, "Segoe UI", sans-serif`;

  ctx.shadowColor = grad[1];
  ctx.shadowBlur = 48;
  ctx.fillStyle = grad[1] + '18';
  ctx.fillText(text, rightX, baselineY);
  ctx.shadowBlur = 0;

  const w = ctx.measureText(text).width;
  const g = ctx.createLinearGradient(rightX - w, baselineY - size, rightX, baselineY);
  g.addColorStop(0, grad[0]);
  g.addColorStop(0.45, grad[1]);
  g.addColorStop(1, grad[2]);
  ctx.fillStyle = g;
  ctx.fillText(text, rightX, baselineY);

  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = Math.max(3, size * 0.035);
  ctx.strokeText(text, rightX, baselineY);
  ctx.fillStyle = g;
  ctx.fillText(text, rightX, baselineY);

  ctx.fillStyle = accent + 'cc';
  ctx.font = `700 ${Math.max(11, size * 0.09)}px system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText('MILESTONE', rightX, baselineY - size - 8);
}

/**
 * Compact call MC → peak MC (no panel, no labels); centered and tight.
 */
function drawMcJourney(ctx, cardX, y, cardW, callStr, peakStr, accent) {
  const blockW = Math.min(cardW * 0.62, 560);
  const bx = cardX + (cardW - blockW) / 2;
  const valueY = y + 4;
  const arrowY = y + 38;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(200, 200, 210, 0.92)';
  const callSize = fitFontSize(ctx, callStr, blockW * 0.42, 42, 28, '600');
  ctx.font = `600 ${callSize}px system-ui, "Segoe UI", sans-serif`;
  ctx.fillText(callStr, bx, valueY);
  const callW = ctx.measureText(callStr).width;

  ctx.textAlign = 'right';
  ctx.fillStyle = TEXT;
  const peakSize = fitFontSize(ctx, peakStr, blockW * 0.48, 60, 32, '800');
  ctx.font = `800 ${peakSize}px system-ui, "Segoe UI", sans-serif`;
  const peakRight = bx + blockW;
  ctx.fillText(peakStr, peakRight, valueY - 2);
  const peakW = ctx.measureText(peakStr).width;

  const gap = 20;
  const a0 = bx + callW + gap;
  const a1 = peakRight - peakW - gap;
  if (a1 > a0 + 24) {
    const lg = ctx.createLinearGradient(a0, arrowY, a1, arrowY);
    lg.addColorStop(0, 'rgba(255,255,255,0.12)');
    lg.addColorStop(0.55, accent);
    lg.addColorStop(1, accent);
    ctx.strokeStyle = lg;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a0, arrowY);
    ctx.lineTo(a1 - 10, arrowY);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(a1, arrowY);
    ctx.lineTo(a1 - 13, arrowY - 7);
    ctx.lineTo(a1 - 13, arrowY + 7);
    ctx.closePath();
    ctx.fill();
  }

  return 56;
}

function drawCallerAvatar(ctx, img, x, y, size, ring, letter) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    const s = Math.max(size / img.width, size / img.height);
    ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s);
  } else {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = TEXT;
    ctx.font = `700 ${size * 0.38}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter.charAt(0).toUpperCase(), cx, cy + 1);
  }
  ctx.restore();
  ctx.strokeStyle = ring;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 + 2, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * @param {object} payload
 * @returns {Promise<Buffer>}
 */
async function buildMilestoneDataCardPng(payload) {
  const accent = channelAccent(payload.channel);
  const glow =
    payload.channel === 'bot' ? 'rgba(34, 197, 94, 0.16)' : 'rgba(59, 130, 246, 0.16)';

  const [tokenImg, avatarImg, mgImg] = await Promise.all([
    loadRemoteImage(payload.tokenImageUrl),
    loadRemoteImage(payload.callerAvatarUrl),
    loadMgMarkImage()
  ]);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  paintCardBackground(ctx, W, H, glow, accent.primary);
  paintMgWatermark(ctx, mgImg, W, H);

  const pad = 52;
  const multStr =
    Number(payload.headlineMultiple) % 1 === 0
      ? `${Math.round(Number(payload.headlineMultiple))}×`
      : `${Number(payload.headlineMultiple).toFixed(1)}×`;

  const callMc = formatUsd(payload.callMc);
  const peakMc = formatUsd(payload.peakMc);
  const calledAgo = payload.calledAgo || '—';
  const coinAge =
    payload.coinAge && payload.coinAge !== '—' ? String(payload.coinAge) : '';

  const tokenSize = 392;
  const heroTop = 72;
  const tokenX = pad + 8;
  const tokenY = heroTop;
  const heroCenterY = tokenY + tokenSize / 2;

  drawSoftGlow(ctx, tokenX + tokenSize * 0.5, heroCenterY, tokenSize * 0.75, glow);
  drawTokenHero(ctx, tokenImg, tokenX, tokenY, tokenSize, accent.primary, payload.ticker);
  if (coinAge) {
    drawCoinAgeTag(ctx, coinAge, tokenX, tokenY, tokenSize, accent.primary);
  }

  const rightX = tokenX + tokenSize + 40;
  const rightW = W - pad - rightX;

  const tick = `$${payload.ticker}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = accent.primary;
  const tickSize = fitFontSize(ctx, tick, rightW, 50, 30, '700');
  ctx.font = `700 ${tickSize}px system-ui, sans-serif`;
  ctx.fillText(tick, rightX, tokenY + 8);

  const name = truncate(payload.tokenName, 30);
  ctx.fillStyle = TEXT;
  const nameSize = fitFontSize(ctx, name, rightW, 40, 22, '600');
  ctx.font = `600 ${nameSize}px system-ui, sans-serif`;
  ctx.fillText(name, rightX, tokenY + 8 + tickSize + 8);

  const multTop = tokenY + tokenSize - 12;
  const multSize = fitFontSize(ctx, multStr, rightW, 268, 118, '800');
  drawSoftGlow(ctx, rightX + rightW * 0.75, multTop - multSize * 0.5, 200, glow);
  drawMultiplier(
    ctx,
    multStr,
    rightX + rightW,
    multTop,
    multSize,
    accent.grad,
    accent.primary
  );

  const heroBottom = tokenY + tokenSize + 12;
  const mcY = heroBottom + 28;
  const mcBlockH = drawMcJourney(ctx, pad, mcY, W - pad * 2, callMc, peakMc, accent.primary);

  const footerH = 58;
  const footerTop = H - pad - footerH;
  const footerW = W - pad * 2;
  const avSize = 88;
  const callerGapAboveFooter = 16;
  let callerY = footerTop - callerGapAboveFooter - avSize;
  const minCallerY = mcY + mcBlockH + 20;
  if (callerY < minCallerY) callerY = minCallerY;

  drawCallerAvatar(ctx, avatarImg, pad, callerY, avSize, accent.primary, payload.callerName);

  const callerMid = callerY + avSize / 2;
  const callerTextX = pad + avSize + 20;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = TEXT;
  ctx.font = '800 32px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(truncate(payload.callerName, 22), callerTextX, callerMid - 8);

  const credit = payload.callerXHandle
    ? `@${payload.callerXHandle}`
    : String(payload.attribution || '')
        .replace(/^Credit\s*·\s*/i, '')
        .trim();
  if (credit) {
    ctx.fillStyle = 'rgba(212, 212, 220, 0.95)';
    ctx.font = '600 19px system-ui, "Segoe UI", sans-serif';
    ctx.fillText(truncate(credit, 32), callerTextX, callerMid + 22);
  }

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = accent.primary;
  ctx.font = '800 40px system-ui, "Segoe UI", sans-serif';
  ctx.fillText(calledAgo, W - pad, callerMid);

  const meta = [];
  const spotX = formatMultiple(payload.spotMultiple);
  const spotMc = formatUsd(payload.spotMc);
  if (spotX !== '—') meta.push(`${spotX} spot · ${spotMc}`);
  meta.push(payload.channelLabel);
  const metaLine = meta.join('   ·   ');

  const footerTextY = footerTop + footerH / 2 + 1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(212, 212, 220, 0.96)';
  const metaSize = fitFontSize(ctx, metaLine, footerW * 0.72, 19, 16, '600');
  ctx.font = `600 ${metaSize}px system-ui, "Segoe UI", sans-serif`;
  ctx.fillText(metaLine, pad, footerTextY);

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(180, 180, 192, 0.98)';
  const brandSize = fitFontSize(ctx, 'mcgbot.xyz', footerW * 0.28, 18, 15, '700');
  ctx.font = `700 ${brandSize}px system-ui, "Segoe UI", sans-serif`;
  ctx.fillText('mcgbot.xyz', W - pad, footerTextY);

  return canvas.toBuffer('image/png');
}

module.exports = {
  buildMilestoneDataCardPng,
  CARD_WIDTH: W,
  CARD_HEIGHT: H
};
