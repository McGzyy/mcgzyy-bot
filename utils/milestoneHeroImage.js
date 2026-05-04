'use strict';

const { createCanvas } = require('canvas');

const W = 1200;
const H = 675;

/** Mulberry32 PRNG for stable “random but repeatable” charts per seed key. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  const s = String(str || 'milestone');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Decorative milestone card: blurred pseudo-chart background + bold multiplier.
 * No live OHLCV — cheap, reusable look until a real chart pipeline returns.
 *
 * @param {{ milestoneX: number, seedKey?: string, callSourceType?: string|null, ticker?: string|null }} p
 * @returns {Promise<Buffer>}
 */
async function buildMilestoneHeroPng(p) {
  const mx = Number(p.milestoneX);
  const mult =
    Number.isFinite(mx) && mx % 1 !== 0 ? `${mx.toFixed(2)}×` : `${Math.round(Number(mx) || 0)}×`;

  const seed = hashSeed(`${p.seedKey || ''}|${p.milestoneX}|${p.callSourceType || ''}`);
  const rand = mulberry32(seed);

  const isBot = String(p.callSourceType || '') === 'bot_call';
  const lineA = isBot ? 'rgba(34, 197, 94, 0.55)' : 'rgba(59, 130, 246, 0.55)';
  const lineB = isBot ? 'rgba(34, 197, 94, 0.22)' : 'rgba(59, 130, 246, 0.22)';
  const fillTop = isBot ? 'rgba(22, 101, 52, 0.12)' : 'rgba(30, 58, 138, 0.12)';

  const bg = createCanvas(W, H);
  const b = bg.getContext('2d');

  const g0 = b.createLinearGradient(0, 0, W, H);
  g0.addColorStop(0, '#04040a');
  g0.addColorStop(0.45, '#080818');
  g0.addColorStop(1, '#020206');
  b.fillStyle = g0;
  b.fillRect(0, 0, W, H);

  b.strokeStyle = 'rgba(255, 255, 255, 0.035)';
  b.lineWidth = 1;
  for (let x = 0; x < W; x += 48) {
    b.beginPath();
    b.moveTo(x + 0.5, 0);
    b.lineTo(x + 0.5, H);
    b.stroke();
  }
  for (let y = 0; y < H; y += 42) {
    b.beginPath();
    b.moveTo(0, y + 0.5);
    b.lineTo(W, y + 0.5);
    b.stroke();
  }

  const bars = 64;
  const bw = (W - 80) / bars;
  let baseY = H * 0.62;
  for (let i = 0; i < bars; i += 1) {
    const hBar = 40 + rand() * (H * 0.35);
    const x = 40 + i * bw;
    const y = baseY - hBar;
    b.fillStyle = lineB;
    b.fillRect(x, y, Math.max(2, bw - 2), hBar);
    baseY += (rand() - 0.5) * 6;
    baseY = Math.max(H * 0.35, Math.min(H * 0.72, baseY));
  }

  const pts = 90;
  const margin = 36;
  let lx = margin;
  let ly = H * 0.48 + (rand() - 0.5) * 40;
  b.strokeStyle = lineA;
  b.lineWidth = 3;
  b.beginPath();
  b.moveTo(lx, ly);
  for (let i = 1; i < pts; i += 1) {
    lx = margin + ((W - 2 * margin) * i) / (pts - 1);
    ly += (rand() - 0.48) * 28;
    ly = Math.max(H * 0.12, Math.min(H * 0.88, ly));
    b.lineTo(lx, ly);
  }
  b.stroke();

  b.strokeStyle = isBot ? 'rgba(74, 222, 128, 0.35)' : 'rgba(147, 197, 253, 0.35)';
  b.lineWidth = 1.5;
  b.beginPath();
  lx = margin;
  ly = H * 0.42 + (rand() - 0.5) * 30;
  b.moveTo(lx, ly);
  for (let i = 1; i < pts; i += 1) {
    lx = margin + ((W - 2 * margin) * i) / (pts - 1);
    ly += (rand() - 0.5) * 18;
    ly = Math.max(H * 0.15, Math.min(H * 0.78, ly));
    b.lineTo(lx, ly);
  }
  b.stroke();

  const gFill = b.createLinearGradient(0, H * 0.2, 0, H * 0.85);
  gFill.addColorStop(0, 'rgba(0,0,0,0)');
  gFill.addColorStop(1, fillTop);
  b.fillStyle = gFill;
  b.fillRect(0, 0, W, H);

  const out = createCanvas(W, H);
  const ctx = out.getContext('2d');

  let blurred = false;
  try {
    ctx.filter = 'blur(9px)';
    ctx.drawImage(bg, -40, -40, W + 80, H + 80);
    blurred = true;
  } catch (_e) {
    /* node-canvas without filter support */
  }
  ctx.filter = 'none';
  if (!blurred) {
    ctx.drawImage(bg, 0, 0, W, H);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.drawImage(bg, 0, 0, W, H);
  }

  const vg = ctx.createRadialGradient(W * 0.5, H * 0.48, 60, W * 0.5, H * 0.52, W * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
  ctx.fillRect(0, H * 0.36, W, H * 0.34);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = W / 2;
  const cy = H * 0.5;

  ctx.font = '800 168px system-ui, "Segoe UI", sans-serif';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.82)';
  ctx.lineWidth = 16;
  ctx.strokeText(mult, cx, cy);

  const gText = ctx.createLinearGradient(cx - 220, cy - 80, cx + 220, cy + 80);
  if (isBot) {
    gText.addColorStop(0, '#86efac');
    gText.addColorStop(0.5, '#22c55e');
    gText.addColorStop(1, '#16a34a');
  } else {
    gText.addColorStop(0, '#bfdbfe');
    gText.addColorStop(0.5, '#3b82f6');
    gText.addColorStop(1, '#1d4ed8');
  }
  ctx.fillStyle = gText;
  ctx.fillText(mult, cx, cy);

  const tick = String(p.ticker || '')
    .trim()
    .toUpperCase()
    .replace(/^\$+/, '');
  if (tick) {
    ctx.font = '600 28px system-ui, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(250, 250, 250, 0.72)';
    ctx.fillText(`$${tick}`, cx, cy + 118);
  }

  return out.toBuffer('image/png');
}

module.exports = {
  buildMilestoneHeroPng
};
