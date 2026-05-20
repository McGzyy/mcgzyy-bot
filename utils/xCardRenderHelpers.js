'use strict';

const axios = require('axios');

const BG_DEEP = '#040408';
const BG_MID = '#0a0a12';
const PANEL = 'rgba(255, 255, 255, 0.04)';
const BORDER = 'rgba(255, 255, 255, 0.1)';
const TEXT = '#fafafa';
const MUTED = 'rgba(161, 161, 170, 0.95)';
const DIM = 'rgba(113, 113, 122, 0.9)';

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
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 * @param {string} [fill]
 * @param {string} [stroke]
 */
function drawPanel(ctx, x, y, w, h, r, fill = PANEL, stroke = BORDER) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.stroke();
  }
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 * @param {number} maxSize
 * @param {number} minSize
 * @param {string} weight
 */
function fitFontSize(ctx, text, maxWidth, maxSize, minSize, weight = '800') {
  for (let s = maxSize; s >= minSize; s -= 2) {
    ctx.font = `${weight} ${s}px system-ui, "Segoe UI", sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) {
      return s;
    }
  }
  return minSize;
}

/**
 * @param {string} text
 * @param {number} maxLen
 */
function truncate(text, maxLen) {
  const s = String(text || '').trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(1, maxLen - 1))}…`;
}

function formatUsd(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '—';
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 10_000) return `$${(num / 1000).toFixed(1)}k`;
  if (num >= 1000) return `$${(num / 1000).toFixed(2)}k`;
  return `$${Math.round(num).toLocaleString()}`;
}

function formatMultiple(x) {
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n >= 10 ? `${n.toFixed(1)}×` : `${n.toFixed(2)}×`;
}

/**
 * @param {string|number|Date|null|undefined} isoOrMs
 * @returns {string|null}
 */
function formatDurationAgo(isoOrMs) {
  if (isoOrMs == null || isoOrMs === '') return null;
  const ts =
    typeof isoOrMs === 'number' && Number.isFinite(isoOrMs)
      ? isoOrMs
      : new Date(isoOrMs).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const diffMs = Date.now() - ts;
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 8) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

/**
 * Coin / pair age from pairCreatedAt (ms) or ageMinutes.
 * @param {{ pairCreatedAtMs?: number|null, ageMinutes?: number|null }} p
 */
function formatCoinAge(p) {
  if (p.pairCreatedAtMs != null && Number.isFinite(p.pairCreatedAtMs) && p.pairCreatedAtMs > 0) {
    const label = formatDurationAgo(p.pairCreatedAtMs);
    return label ? label.replace(/ ago$/, ' old') : '—';
  }
  const am = Number(p.ageMinutes);
  if (Number.isFinite(am) && am >= 0) {
    if (am < 60) return `${Math.round(am)}m old`;
    if (am < 1440) return `${Math.round(am / 60)}h old`;
    return `${Math.round(am / 1440)}d old`;
  }
  return '—';
}

/**
 * @param {string} url
 * @returns {Promise<import('canvas').Image|null>}
 */
async function loadRemoteImage(url) {
  const u = String(url || '').trim();
  if (!u.startsWith('http')) return null;
  try {
    const res = await axios.get(u, {
      responseType: 'arraybuffer',
      timeout: 9000,
      maxContentLength: 4 * 1024 * 1024,
      headers: { 'User-Agent': 'McGBot/1.0 (+https://mcgbot.xyz)' }
    });
    const { loadImage } = require('canvas');
    return await loadImage(Buffer.from(res.data));
  } catch {
    return null;
  }
}

/**
 * @param {import('canvas').CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 */
function paintEliteBackground(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, BG_DEEP);
  g.addColorStop(0.45, BG_MID);
  g.addColorStop(1, '#06060c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.028)';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
  }

  const glow = ctx.createRadialGradient(w * 0.82, h * 0.18, 20, w * 0.82, h * 0.18, w * 0.55);
  glow.addColorStop(0, 'rgba(59, 130, 246, 0.07)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
}

/**
 * @param {'bot'|'member'|'watch'} channel
 */
function channelAccent(channel) {
  if (channel === 'bot') {
    return {
      primary: '#22c55e',
      soft: 'rgba(34, 197, 94, 0.18)',
      grad: ['#86efac', '#22c55e', '#16a34a']
    };
  }
  if (channel === 'watch') {
    return {
      primary: '#a78bfa',
      soft: 'rgba(167, 139, 250, 0.18)',
      grad: ['#ddd6fe', '#a78bfa', '#7c3aed']
    };
  }
  return {
    primary: '#3b82f6',
    soft: 'rgba(59, 130, 246, 0.18)',
    grad: ['#bfdbfe', '#3b82f6', '#1d4ed8']
  };
}

module.exports = {
  BG_DEEP,
  TEXT,
  MUTED,
  DIM,
  BORDER,
  roundRectPath,
  drawPanel,
  fitFontSize,
  truncate,
  formatUsd,
  formatMultiple,
  formatDurationAgo,
  formatCoinAge,
  loadRemoteImage,
  paintEliteBackground,
  channelAccent
};
