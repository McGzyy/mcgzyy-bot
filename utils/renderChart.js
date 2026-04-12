'use strict';

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

const WIDTH = 960;
const HEIGHT = 520;
const BG = '#0d1117';
const LINE_GREEN = '#34d399';
const TICK = 'rgba(148, 163, 184, 0.55)';
const GRID_Y = 'rgba(148, 163, 184, 0.07)';

/** One shared canvas size; reuse instance per chartjs-node-canvas guidance. */
const chartCanvas = new ChartJSNodeCanvas({
  width: WIDTH,
  height: HEIGHT,
  backgroundColour: BG
});

function toLabel(ts) {
  const d =
    ts instanceof Date
      ? ts
      : new Date(typeof ts === 'number' && !Number.isNaN(ts) ? ts : Date.parse(String(ts)));
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * @param {{ prices: number[], timestamps: Array<number|string|Date>, label?: string }} param0
 * @returns {Promise<Buffer>}
 */
async function renderPriceChart({ prices, timestamps, label }) {
  const pIn = Array.isArray(prices) ? prices : [];
  const tIn = Array.isArray(timestamps) ? timestamps : [];
  const n = Math.min(pIn.length, tIn.length);
  if (n < 1) {
    throw new Error('renderPriceChart: need at least one aligned price and timestamp');
  }

  const data = pIn.slice(0, n).map((x) => Number(x));
  const labels = tIn.slice(0, n).map(toLabel);

  const configuration = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: label != null && label !== '' ? String(label) : 'Price',
          data,
          borderColor: LINE_GREEN,
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: TICK,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
            font: { size: 10 }
          }
        },
        y: {
          grid: { color: GRID_Y, drawBorder: false },
          border: { display: false },
          ticks: {
            color: TICK,
            maxTicksLimit: 5,
            font: { size: 10 },
            padding: 4
          }
        }
      },
      layout: {
        padding: { top: 12, right: 14, bottom: 10, left: 10 }
      }
    }
  };

  return chartCanvas.renderToBuffer(configuration, 'image/png');
}

/**
 * Build aligned series from tracked call `priceHistory` entries.
 * @param {{ priceHistory?: Array<{ t?: number|string, price?: number, mc?: number, marketCap?: number, ts?: number|string, timestamp?: number|string }> }} trackedCall
 * @returns {{ prices: number[], timestamps: number[] } | null}
 */
function seriesFromTrackedPriceHistory(trackedCall) {
  const h = trackedCall?.priceHistory;
  if (!Array.isArray(h) || h.length === 0) return null;

  const prices = [];
  const timestamps = [];

  for (const p of h) {
    const price = Number(p?.price ?? p?.mc ?? p?.marketCap);
    if (!Number.isFinite(price)) continue;

    const rawT = p?.t ?? p?.ts ?? p?.timestamp;
    let ts;
    if (typeof rawT === 'number' && Number.isFinite(rawT)) {
      ts = rawT;
    } else if (rawT instanceof Date) {
      ts = rawT.getTime();
    } else {
      ts = Date.parse(String(rawT || ''));
    }
    if (Number.isNaN(ts)) continue;

    prices.push(price);
    timestamps.push(ts);
  }

  if (prices.length < 1) return null;
  return { prices, timestamps };
}

module.exports = { renderPriceChart, seriesFromTrackedPriceHistory };
