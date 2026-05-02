'use strict';

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 520;
const DEFAULT_BG = '#0d1117';
const TICK = 'rgba(148, 163, 184, 0.75)';
const GRID = 'rgba(148, 163, 184, 0.08)';
const CANDLE_UP = '#34d399';
const CANDLE_DOWN = '#f87171';
const CANDLE_FLAT = '#94a3b8';

/** @type {{ key: string, canvas: InstanceType<typeof ChartJSNodeCanvas> } | null} */
let rendererCache = null;

/**
 * @param {import('chart.js').Chart & { registerables?: import('chart.js').ChartComponentLike[] }} ChartJS
 */
function chartCallback(ChartJS) {
  require('chartjs-adapter-date-fns');
  require('chartjs-chart-financial');
  if (ChartJS.registerables) {
    ChartJS.register(...ChartJS.registerables);
  }
}

/**
 * @param {number} w
 * @param {number} h
 * @param {string} bg
 */
function getRenderer(w, h, bg) {
  const key = `${w}x${h}|${bg}`;
  if (!rendererCache || rendererCache.key !== key) {
    rendererCache = {
      key,
      canvas: new ChartJSNodeCanvas({
        width: w,
        height: h,
        backgroundColour: bg,
        chartCallback
      })
    };
  }
  return rendererCache.canvas;
}

/**
 * @param {unknown} t
 * @returns {number | null}
 */
function toTimeMs(t) {
  if (t instanceof Date) {
    const ms = t.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof t === 'number' && Number.isFinite(t)) {
    return t < 1e12 ? Math.round(t * 1000) : Math.round(t);
  }
  if (typeof t === 'string' && t.trim()) {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

const OVERLAY_CALL = 'rgba(96, 165, 250, 0.9)';
const OVERLAY_ATH = 'rgba(250, 204, 21, 0.92)';
const OVERLAY_MIGRATE = 'rgba(20, 184, 166, 0.92)';
const MARKER_DEX_PAID = 'rgba(34, 197, 94, 0.95)';
const MARKER_DEX_PAID_STROKE = 'rgba(22, 163, 74, 1)';
const MARKER_DEV_SOLD = 'rgba(248, 113, 113, 0.95)';
const MARKER_DEV_SOLD_STROKE = 'rgba(220, 38, 38, 1)';
const EVENT_MARKER_RADIUS = 4.5;

const VOL_STRIP_FRAC = 0.2;
const VOL_GREEN = 'rgba(52, 211, 153, 0.72)';
const VOL_RED = 'rgba(248, 113, 113, 0.72)';

function formatVolumeTick(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '';
  const a = Math.abs(num);
  if (a >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(num / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  if (a >= 1) return num.toFixed(0);
  return num.toPrecision(2);
}

/**
 * Volume histogram in the bottom strip + separate volume scale labels on the left (drawn; not the price y-axis).
 * Runs before candle datasets so wicks/bodies draw on top.
 * @param {Array<{ x: number, o: number, h: number, l: number, c: number, v?: number }>} series
 */
function createVolumeStripPlugin(series) {
  return {
    id: 'volumeStrip',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea } = chart;
      const xScale = chart.scales.x;
      if (!ctx || !chartArea || !xScale || !Array.isArray(series) || series.length < 1) {
        return;
      }

      const stripH = (chartArea.bottom - chartArea.top) * VOL_STRIP_FRAC;
      const volTop = chartArea.bottom - stripH;
      const innerH = Math.max(1, stripH - 2);

      const volumes = series.map(s =>
        Number.isFinite(s.v) && s.v >= 0 ? s.v : 0
      );
      const maxV = Math.max(...volumes, 1e-12);

      const n = series.length;
      const barW = Math.max(1, Math.min(14, (chartArea.width / Math.max(n, 1)) * 0.45));

      ctx.save();

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chartArea.left, volTop);
      ctx.lineTo(chartArea.right, volTop);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.beginPath();
      ctx.moveTo(chartArea.left, volTop);
      ctx.lineTo(chartArea.left, chartArea.bottom);
      ctx.stroke();

      for (let i = 0; i < series.length; i++) {
        const s = series[i];
        const v = volumes[i];
        if (!(v > 0)) continue;
        const px = xScale.getPixelForValue(s.x);
        if (!Number.isFinite(px)) continue;
        const barH = (v / maxV) * innerH;
        const top = chartArea.bottom - barH;
        const bull = s.c >= s.o;
        ctx.fillStyle = bull ? VOL_GREEN : VOL_RED;
        ctx.fillRect(px - barW / 2, top, barW, barH);
      }

      ctx.fillStyle = TICK;
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const labelX = chartArea.left - 4;
      const tickVals = [maxV, maxV * 0.5, 0];
      for (const lab of tickVals) {
        const frac = maxV > 0 ? lab / maxV : 0;
        const y = chartArea.bottom - frac * innerH - 1;
        if (y < volTop - 6 || y > chartArea.bottom + 4) continue;
        ctx.fillText(formatVolumeTick(lab), labelX, y);
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Vol', chartArea.left, volTop - 2);

      ctx.restore();
    }
  };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} px
 * @param {number} py
 * @param {string} fill
 * @param {string} stroke
 * @param {number} [r]
 */
function drawPriceTimeMarker(ctx, px, py, fill, stroke, r = EVENT_MARKER_RADIUS) {
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

/**
 * @param {{ left: number, top: number, right: number, bottom: number }} chartArea
 * @param {number} px
 * @param {number} py
 * @returns {boolean}
 */
function pixelInChartArea(chartArea, px, py) {
  return (
    px >= chartArea.left - 0.5 &&
    px <= chartArea.right + 0.5 &&
    py >= chartArea.top - 0.5 &&
    py <= chartArea.bottom + 0.5
  );
}

/**
 * @param {{
 *   callTimestampMs: number | null,
 *   athPriceNum: number | null,
 *   migratedAtMs: number | null,
 *   dexPaidEvents: Array<{ t: number, p: number }>,
 *   devSoldEvents: Array<{ t: number, p: number }>
 * }} opts
 */
function createCandlestickOverlayPlugin(opts) {
  const {
    callTimestampMs,
    athPriceNum,
    migratedAtMs,
    dexPaidEvents,
    devSoldEvents
  } = opts;

  return {
    id: 'candlestickOverlays',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea } = chart;
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      if (!ctx || !chartArea || !xScale || !yScale) return;

      ctx.save();

      if (callTimestampMs != null && Number.isFinite(callTimestampMs)) {
        const px = xScale.getPixelForValue(callTimestampMs);
        if (
          Number.isFinite(px) &&
          px >= chartArea.left - 0.5 &&
          px <= chartArea.right + 0.5
        ) {
          ctx.beginPath();
          ctx.strokeStyle = OVERLAY_CALL;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]);
          ctx.moveTo(px, chartArea.top);
          ctx.lineTo(px, chartArea.bottom);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      if (migratedAtMs != null && Number.isFinite(migratedAtMs)) {
        const px = xScale.getPixelForValue(migratedAtMs);
        if (
          Number.isFinite(px) &&
          px >= chartArea.left - 0.5 &&
          px <= chartArea.right + 0.5
        ) {
          ctx.beginPath();
          ctx.strokeStyle = OVERLAY_MIGRATE;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 5]);
          ctx.moveTo(px, chartArea.top);
          ctx.lineTo(px, chartArea.bottom);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      if (athPriceNum != null && Number.isFinite(athPriceNum)) {
        const py = yScale.getPixelForValue(athPriceNum);
        if (
          Number.isFinite(py) &&
          py >= chartArea.top - 0.5 &&
          py <= chartArea.bottom + 0.5
        ) {
          ctx.beginPath();
          ctx.strokeStyle = OVERLAY_ATH;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 5]);
          ctx.moveTo(chartArea.left, py);
          ctx.lineTo(chartArea.right, py);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      for (const e of dexPaidEvents) {
        const px = xScale.getPixelForValue(e.t);
        const py = yScale.getPixelForValue(e.p);
        if (
          !Number.isFinite(px) ||
          !Number.isFinite(py) ||
          !pixelInChartArea(chartArea, px, py)
        ) {
          continue;
        }
        drawPriceTimeMarker(ctx, px, py, MARKER_DEX_PAID, MARKER_DEX_PAID_STROKE);
      }

      for (const e of devSoldEvents) {
        const px = xScale.getPixelForValue(e.t);
        const py = yScale.getPixelForValue(e.p);
        if (
          !Number.isFinite(px) ||
          !Number.isFinite(py) ||
          !pixelInChartArea(chartArea, px, py)
        ) {
          continue;
        }
        drawPriceTimeMarker(ctx, px, py, MARKER_DEV_SOLD, MARKER_DEV_SOLD_STROKE);
      }

      ctx.restore();
    }
  };
}

/**
 * @param {unknown} raw
 * @returns {Array<{ x: number, o: number, h: number, l: number, c: number, v?: number }>}
 */
function normalizeCandles(raw) {
  if (!Array.isArray(raw)) return [];

  const out = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const x = toTimeMs(/** @type {{ time?: unknown }} */ (row).time);
    const o = toNum(/** @type {{ open?: unknown }} */ (row).open);
    const h = toNum(/** @type {{ high?: unknown }} */ (row).high);
    const l = toNum(/** @type {{ low?: unknown }} */ (row).low);
    const c = toNum(/** @type {{ close?: unknown }} */ (row).close);
    if (x == null || [o, h, l, c].some(n => Number.isNaN(n))) continue;
    const vol = toNum(/** @type {{ volume?: unknown }} */ (row).volume);
    /** @type {{ x: number, o: number, h: number, l: number, c: number, v?: number }} */
    const pt = { x, o, h, l, c };
    if (Number.isFinite(vol) && vol >= 0) {
      pt.v = vol;
    }
    out.push(pt);
  }
  return out;
}

/**
 * @param {Array<{ v?: number }>} normalized
 * @returns {boolean}
 */
function hasUsableVolume(normalized) {
  return (
    Array.isArray(normalized) &&
    normalized.some(p => Number.isFinite(p.v) && p.v > 0)
  );
}

/**
 * @param {unknown} raw
 * @returns {Array<{ t: number, p: number }>}
 */
function normalizePriceTimeEvents(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const t = toTimeMs(/** @type {{ time?: unknown }} */ (row).time);
    const p = toNum(/** @type {{ price?: unknown }} */ (row).price);
    if (t == null || !Number.isFinite(p)) continue;
    out.push({ t, p });
  }
  return out;
}

/**
 * @typedef {{
 *   width?: number,
 *   height?: number,
 *   backgroundColour?: string,
 *   title?: string,
 *   minCandles?: number,
 *   yAxisLabel?: string,
 *   callTimestamp?: number|string|Date,
 *   athPrice?: number,
 *   migratedAt?: number|string|Date,
 *   dexPaidEvents?: Array<{ time: number|string|Date, price: number }>,
 *   devSoldEvents?: Array<{ time: number|string|Date, price: number }>
 * }} CandlestickChartOptions
 */

/**
 * Render OHLCV candles as a PNG (candlestick chart). Reusable from !call, !watch, milestones, etc.
 * Does not post to Discord — returns a buffer only.
 *
 * Optional overlays (omit for default chart only):
 * - **callTimestamp** — vertical dashed line at first-call time (same units as candle `time`: ms, sec, or ISO).
 * - **athPrice** — horizontal dashed line at ATH price; Y-axis is padded to include this level when set.
 * - **migratedAt** — vertical dashed line (teal) at migration time when in view.
 * - **dexPaidEvents** / **devSoldEvents** — `{ time, price }[]` markers (green / red circles) when both map inside the plot area.
 *
 * @param {Array<{ time: number|string|Date, open: number, high: number, low: number, close: number, volume?: number }>} candles
 * @param {CandlestickChartOptions} [options]
 * @returns {Promise<Buffer | null>} `null` if too few valid candles or render fails
 */
async function renderCandlestickChart(candles, options = {}) {
  const minCandles =
    typeof options.minCandles === 'number' && options.minCandles >= 1
      ? Math.floor(options.minCandles)
      : 2;

  const normalized = normalizeCandles(candles);
  if (normalized.length < minCandles) return null;

  /** Zero-height candles (flat pool) are invisible at chart scale — nudge OHLC slightly. */
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    const mid = (c.h + c.l) / 2;
    if (!Number.isFinite(mid) || mid <= 0) continue;
    const span = Math.abs(c.h - c.l);
    const rel = span / mid;
    if (!Number.isFinite(rel) || rel < 1e-14) {
      const eps = Math.max(mid * 0.004, 1e-18);
      normalized[i] = {
        x: c.x,
        o: Math.min(Math.max(c.o, mid - eps), mid + eps),
        h: mid + eps,
        l: Math.max(mid - eps, 1e-18),
        c: Math.min(Math.max(c.c, mid - eps), mid + eps),
        ...(Number.isFinite(c.v) && c.v >= 0 ? { v: c.v } : {})
      };
    }
  }

  const width = Math.max(
    200,
    Math.min(4096, Number(options.width) || DEFAULT_WIDTH)
  );
  const height = Math.max(
    160,
    Math.min(4096, Number(options.height) || DEFAULT_HEIGHT)
  );
  const backgroundColour =
    options.backgroundColour != null && options.backgroundColour !== ''
      ? String(options.backgroundColour)
      : DEFAULT_BG;
  const label =
    options.title != null && String(options.title).trim() !== ''
      ? String(options.title).trim()
      : 'Price';

  const callTimestampMs =
    options.callTimestamp !== undefined && options.callTimestamp !== null
      ? toTimeMs(options.callTimestamp)
      : null;

  const athRaw = options.athPrice;
  const athPriceNum =
    athRaw !== undefined && athRaw !== null && String(athRaw).trim() !== ''
      ? toNum(athRaw)
      : NaN;
  const hasAthOverlay = Number.isFinite(athPriceNum);

  const migratedAtMs =
    options.migratedAt !== undefined && options.migratedAt !== null
      ? toTimeMs(options.migratedAt)
      : null;
  const hasMigrateOverlay =
    migratedAtMs != null && Number.isFinite(migratedAtMs);

  const dexPaidEvents = normalizePriceTimeEvents(options.dexPaidEvents);
  const devSoldEvents = normalizePriceTimeEvents(options.devSoldEvents);

  const yScaleExtra =
    hasAthOverlay
      ? (() => {
          const lows = normalized.map(c => c.l);
          const highs = normalized.map(c => c.h);
          let yMin = Math.min(...lows);
          let yMax = Math.max(...highs);
          yMin = Math.min(yMin, athPriceNum);
          yMax = Math.max(yMax, athPriceNum);
          const span = yMax - yMin || Math.abs(yMax || 1) * 0.01 || 0.01;
          const pad = span * 0.04;
          return { min: yMin - pad, max: yMax + pad };
        })()
      : null;

  const overlayPlugins = [];
  const hasCallOverlay =
    callTimestampMs != null && Number.isFinite(callTimestampMs);
  const hasAnyOverlay =
    hasCallOverlay ||
    hasAthOverlay ||
    hasMigrateOverlay ||
    dexPaidEvents.length > 0 ||
    devSoldEvents.length > 0;

  if (hasAnyOverlay) {
    overlayPlugins.push(
      createCandlestickOverlayPlugin({
        callTimestampMs: hasCallOverlay ? callTimestampMs : null,
        athPriceNum: hasAthOverlay ? athPriceNum : null,
        migratedAtMs: hasMigrateOverlay ? migratedAtMs : null,
        dexPaidEvents,
        devSoldEvents
      })
    );
  }

  const hasVolumePanel = hasUsableVolume(normalized);
  const chartPlugins = [];
  if (hasVolumePanel) {
    chartPlugins.push(createVolumeStripPlugin(normalized));
  }
  chartPlugins.push(...overlayPlugins);

  const layoutPaddingLeft = hasVolumePanel ? 46 : 12;

  const configuration = {
    type: 'candlestick',
    data: {
      datasets: [
        {
          label,
          data: normalized,
          // chartjs-chart-financial: close < open uses `.up`, close > open uses `.down`
          borderColors: {
            up: CANDLE_DOWN,
            down: CANDLE_UP,
            unchanged: CANDLE_FLAT
          },
          backgroundColors: {
            up: CANDLE_DOWN,
            down: CANDLE_UP,
            unchanged: CANDLE_FLAT
          }
        }
      ]
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        legend: { display: false },
        title: {
          display: Boolean(
            options.title != null && String(options.title).trim() !== ''
          ),
          text: String(options.title || ''),
          color: TICK,
          font: { size: 13, weight: '600' },
          padding: { top: 6, bottom: 2 }
        },
        tooltip: { enabled: false }
      },
      scales: {
        x: {
          type: 'timeseries',
          offset: true,
          grid: { display: false, drawBorder: false },
          border: { display: false },
          ticks: {
            color: TICK,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 10,
            font: { size: 10 }
          },
          time: {
            displayFormats: {
              millisecond: 'HH:mm:ss',
              second: 'HH:mm:ss',
              minute: 'MMM d HH:mm',
              hour: 'MMM d HH:mm',
              day: 'MMM d',
              week: 'MMM d',
              month: 'MMM yyyy',
              quarter: 'MMM yyyy',
              year: 'yyyy'
            }
          }
        },
        y: {
          position: 'right',
          ...(yScaleExtra
            ? { min: yScaleExtra.min, max: yScaleExtra.max }
            : {}),
          grid: { color: GRID, drawBorder: false },
          border: { display: false },
          ticks: {
            color: TICK,
            maxTicksLimit: 8,
            font: { size: 10 },
            padding: 6,
            callback(value) {
              const n = Number(value);
              if (!Number.isFinite(n)) return '';
              const a = Math.abs(n);
              if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
              if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
              if (a >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
              if (a >= 1) return n.toFixed(2);
              if (a >= 0.01) return n.toFixed(4);
              return n.toPrecision(4);
            }
          },
          title: {
            display: Boolean(
              options.yAxisLabel != null &&
                String(options.yAxisLabel).trim() !== ''
            ),
            text: String(options.yAxisLabel || ''),
            color: TICK,
            font: { size: 10 }
          }
        }
      },
      layout: {
        padding: { top: 10, right: 14, bottom: 10, left: layoutPaddingLeft }
      }
    },
    ...(chartPlugins.length ? { plugins: chartPlugins } : {})
  };

  try {
    const canvas = getRenderer(width, height, backgroundColour);
    return await canvas.renderToBuffer(configuration, 'image/png');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      '[candlestickChart] %s',
      JSON.stringify({
        event: 'render_to_buffer_failed',
        candleCount: normalized.length,
        overlaysPresent: hasAnyOverlay,
        error: msg
      })
    );
    return null;
  }
}

module.exports = { renderCandlestickChart };
