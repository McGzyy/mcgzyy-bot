'use strict';

const axios = require('axios');
const { createCanvas, loadImage } = require('canvas');

const W = 1200;
const H = 675;

/**
 * @param {{ displayName: string, monthLabel: string, avgX: number, totalCalls: number, wins: number, bestMultiple: number, avatarUrl?: string | null }} p
 * @returns {Promise<Buffer>}
 */
async function buildTopMonthlyCallerCardPng(p) {
  const name = String(p.displayName || 'Caller').trim().slice(0, 48);
  const month = String(p.monthLabel || '').trim();

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#050510');
  g.addColorStop(0.5, '#0a0a18');
  g.addColorStop(1, '#020206');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  for (let x = 0; x < W; x += 56) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
    ctx.stroke();
  }

  let avatar = null;
  const url = String(p.avatarUrl || '').trim();
  if (url.startsWith('http')) {
    try {
      const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
      const buf = Buffer.from(res.data);
      avatar = await loadImage(buf);
    } catch {
      avatar = null;
    }
  }

  const cx = W / 2;
  const cy = 200;
  const r = 88;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (avatar) {
    const s = Math.max((r * 2) / avatar.width, (r * 2) / avatar.height);
    const dw = avatar.width * s;
    const dh = avatar.height * s;
    ctx.drawImage(avatar, cx - dw / 2, cy - dh / 2, dw, dh);
  } else {
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '800 72px system-ui, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ch = name.charAt(0).toUpperCase() || '?';
    ctx.fillText(ch, cx, cy + 4);
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(96, 165, 250, 0.6)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(250, 250, 250, 0.85)';
  ctx.font = '600 22px system-ui, Segoe UI, sans-serif';
  ctx.fillText('Top Caller', cx, 54);

  ctx.fillStyle = '#93c5fd';
  ctx.font = '600 18px system-ui, Segoe UI, sans-serif';
  ctx.fillText(month, cx, 84);

  ctx.fillStyle = '#fafafa';
  ctx.font = '800 36px system-ui, Segoe UI, sans-serif';
  ctx.fillText(name, cx, 330);

  ctx.font = '600 20px system-ui, Segoe UI, sans-serif';
  ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
  const avg = Number(p.avgX) || 0;
  const tc = Number(p.totalCalls) || 0;
  const wins = Number(p.wins) || 0;
  const best = Number(p.bestMultiple) || 0;
  ctx.fillText(`${avg.toFixed(2)}× avg · ${tc} calls · ${wins} at ≥2× · best ${best.toFixed(2)}×`, cx, 388);

  return canvas.toBuffer('image/png');
}

module.exports = {
  buildTopMonthlyCallerCardPng
};
