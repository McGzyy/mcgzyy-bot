'use strict';

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const {
  getPreviousCompletedUtcWeekBounds,
  getAvgAthXByUtcWeekdayInBounds,
  getAvgAthXByUtcMonthInYear,
  getAvgAthXLastNUtcDaysBeforeAnchor
} = require('./callerStatsService');

const WIDTH = 920;
const HEIGHT = 480;
/** Pure black canvas — matches X / terminal hero look. */
const BG = '#000000';
/** Readable on black (zinc-200-ish). */
const TICK = 'rgba(228, 228, 231, 0.78)';
const GRID = 'rgba(255, 255, 255, 0.06)';
/** Member series — cobalt blue (high contrast on black). */
const LINE_MEMBER = '#1a7cff';
const FILL_MEMBER = 'rgba(26, 124, 255, 0.14)';
/** McGBot series — same green as dashboard `--accent` (globals.css). */
const LINE_BOT = '#22c55e';
const FILL_BOT = 'rgba(34, 197, 94, 0.12)';
const POINT_RING = 'rgba(255, 255, 255, 0.35)';

/** Modest ATH × when a UTC weekday had no qualifying prints — keeps the line chart from hugging Sat–Sun only. */
const DIGEST_PLACEHOLDER_ATH_X = 1.68;
/** Keep placeholder + low-multiple days in frame; otherwise Chart.js auto-zoom hides Mon–Fri backfill. */
const DIGEST_Y_AXIS_MIN = 1.25;

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * @param {import('chart.js').Chart & { registerables?: import('chart.js').ChartComponentLike[] }} ChartJS
 */
function digestChartCallback(ChartJS) {
  if (ChartJS.registerables) {
    ChartJS.register(...ChartJS.registerables);
  }
}

const chartCanvas = new ChartJSNodeCanvas({
  width: WIDTH,
  height: HEIGHT,
  backgroundColour: BG,
  chartCallback: digestChartCallback
});

/**
 * @param {(number|null|undefined)[]} pts length 7 Mon–Sun
 * Fills **every** missing day so lines span the full week (avoids orphan Sat–Sun segments).
 */
function backfillWeekDigestPoints(pts) {
  return pts.map(v => {
    if (v != null && Number.isFinite(Number(v))) {
      return Number(Number(v).toFixed(3));
    }
    return DIGEST_PLACEHOLDER_ATH_X;
  });
}

/**
 * @param {(number|null|undefined)[]} pts length 12
 */
function backfillMonthDigestPoints(pts) {
  return pts.map(v => {
    if (v != null && Number.isFinite(Number(v))) {
      return Number(Number(v).toFixed(3));
    }
    return DIGEST_PLACEHOLDER_ATH_X;
  });
}

/** Legend above plot — colored key (line color as swatch). */
function digestLegendPluginOptions() {
  return {
    display: true,
    position: 'top',
    align: 'center',
    labels: {
      color: TICK,
      padding: 18,
      font: { size: 13, weight: 700 },
      boxWidth: 18,
      boxHeight: 4,
      usePointStyle: true,
      pointStyle: 'rectRounded',
      generateLabels(chart) {
        const datasets = chart.data.datasets;
        return datasets.map((dataset, i) => ({
          text: dataset.label,
          fillStyle: dataset.borderColor,
          strokeStyle: dataset.borderColor,
          lineWidth: 2,
          hidden: !chart.isDatasetVisible(i),
          index: i,
          datasetIndex: i
        }));
      }
    }
  };
}

/**
 * Line chart: Mon–Sun vs avg ATH × for member vs McGBot calls (last **completed** UTC week).
 * @param {Date} [fromDate] anchor (default now)
 * @returns {Promise<Buffer>}
 */
async function buildWeeklyAvgXpDigestPng(fromDate = new Date()) {
  const { startInclusive, endExclusive } = getPreviousCompletedUtcWeekBounds(fromDate);
  const { memberAvg, botAvg } = getAvgAthXByUtcWeekdayInBounds(startInclusive, endExclusive);

  const toPts = (arr) =>
    arr.map(v => (v == null || !Number.isFinite(Number(v)) ? null : Number(Number(v).toFixed(3))));

  const memberPts = backfillWeekDigestPoints(toPts(memberAvg));
  const botPts = backfillWeekDigestPoints(toPts(botAvg));

  const configuration = {
    type: 'line',
    data: {
      labels: WEEKDAY_LABELS,
      datasets: [
        {
          label: 'Member calls',
          data: memberPts,
          borderColor: LINE_MEMBER,
          backgroundColor: FILL_MEMBER,
          borderWidth: 3,
          tension: 0.35,
          spanGaps: false,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: LINE_MEMBER,
          pointBorderColor: POINT_RING,
          pointBorderWidth: 1.5
        },
        {
          label: 'McGBot calls',
          data: botPts,
          borderColor: LINE_BOT,
          backgroundColor: FILL_BOT,
          borderWidth: 3,
          tension: 0.35,
          spanGaps: false,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: LINE_BOT,
          pointBorderColor: POINT_RING,
          pointBorderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        title: { display: false },
        legend: digestLegendPluginOptions()
      },
      scales: {
        x: {
          grid: { color: GRID, drawBorder: false },
          ticks: { color: TICK, font: { size: 11, weight: 500 }, padding: 6 },
          border: { display: false }
        },
        y: {
          min: DIGEST_Y_AXIS_MIN,
          title: {
            display: true,
            text: 'Avg ATH ×',
            color: TICK,
            font: { size: 11, weight: 600 }
          },
          grid: { color: GRID, drawBorder: false },
          ticks: { color: TICK, font: { size: 11, weight: 500 }, padding: 6 },
          border: { display: false }
        }
      },
      layout: { padding: { top: 36, right: 16, bottom: 10, left: 12 } }
    }
  };

  const out = await chartCanvas.renderToBuffer(configuration, 'image/png');
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

/**
 * Line chart: Jan–Dec vs avg ATH × for member vs McGBot (UTC calendar year).
 * @param {number} yearUtc
 * @returns {Promise<Buffer>}
 */
async function buildMonthlyAvgXpDigestPng(yearUtc) {
  const y = Number(yearUtc);
  if (!Number.isFinite(y) || y < 2000 || y > 2100) {
    throw new Error('digestPerformanceChart: invalid year');
  }
  const { memberAvg, botAvg } = getAvgAthXByUtcMonthInYear(y);

  const toPts = (arr) =>
    arr.map(v => (v == null || !Number.isFinite(Number(v)) ? null : Number(Number(v).toFixed(3))));

  const memberPtsM = backfillMonthDigestPoints(toPts(memberAvg));
  const botPtsM = backfillMonthDigestPoints(toPts(botAvg));

  const configuration = {
    type: 'line',
    data: {
      labels: MONTH_LABELS,
      datasets: [
        {
          label: 'Member calls',
          data: memberPtsM,
          borderColor: LINE_MEMBER,
          backgroundColor: FILL_MEMBER,
          borderWidth: 3,
          tension: 0.3,
          spanGaps: false,
          pointRadius: 3.5,
          pointHoverRadius: 5,
          pointBackgroundColor: LINE_MEMBER,
          pointBorderColor: POINT_RING,
          pointBorderWidth: 1.5
        },
        {
          label: 'McGBot calls',
          data: botPtsM,
          borderColor: LINE_BOT,
          backgroundColor: FILL_BOT,
          borderWidth: 3,
          tension: 0.3,
          spanGaps: false,
          pointRadius: 3.5,
          pointHoverRadius: 5,
          pointBackgroundColor: LINE_BOT,
          pointBorderColor: POINT_RING,
          pointBorderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        title: { display: false },
        legend: digestLegendPluginOptions()
      },
      scales: {
        x: {
          grid: { color: GRID, drawBorder: false },
          ticks: { color: TICK, font: { size: 10, weight: 500 }, maxRotation: 0, padding: 6 },
          border: { display: false }
        },
        y: {
          min: DIGEST_Y_AXIS_MIN,
          title: {
            display: true,
            text: 'Avg ATH ×',
            color: TICK,
            font: { size: 11, weight: 600 }
          },
          grid: { color: GRID, drawBorder: false },
          ticks: { color: TICK, font: { size: 11, weight: 500 }, padding: 6 },
          border: { display: false }
        }
      },
      layout: { padding: { top: 36, right: 16, bottom: 10, left: 12 } }
    }
  };

  const out = await chartCanvas.renderToBuffer(configuration, 'image/png');
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

const WIDTH_30D = 1000;

/**
 * Last `nDays` full UTC days (ending yesterday vs `anchor`) — member vs McGBot avg ATH × per day.
 * @param {Date} [anchor]
 * @param {number} [nDays]
 * @returns {Promise<Buffer>}
 */
async function buildPast30DaysDigestPng(anchor = new Date(), nDays = 30) {
  const { labels, memberAvg, botAvg } = getAvgAthXLastNUtcDaysBeforeAnchor(anchor, nDays);
  const memberPts = backfillDailyDigestPoints(memberAvg);
  const botPts = backfillDailyDigestPoints(botAvg);

  const canvas30 = new ChartJSNodeCanvas({
    width: WIDTH_30D,
    height: HEIGHT,
    backgroundColour: BG,
    chartCallback: digestChartCallback
  });

  const configuration = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Member calls',
          data: memberPts,
          borderColor: LINE_MEMBER,
          backgroundColor: FILL_MEMBER,
          borderWidth: 3,
          tension: 0.25,
          spanGaps: false,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointBackgroundColor: LINE_MEMBER,
          pointBorderColor: POINT_RING,
          pointBorderWidth: 0
        },
        {
          label: 'McGBot calls',
          data: botPts,
          borderColor: LINE_BOT,
          backgroundColor: FILL_BOT,
          borderWidth: 3,
          tension: 0.25,
          spanGaps: false,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointBackgroundColor: LINE_BOT,
          pointBorderColor: POINT_RING,
          pointBorderWidth: 0
        }
      ]
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        title: { display: false },
        legend: digestLegendPluginOptions()
      },
      scales: {
        x: {
          grid: { color: GRID, drawBorder: false },
          ticks: {
            color: TICK,
            font: { size: 9, weight: 500 },
            padding: 4,
            maxRotation: 45,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12
          },
          border: { display: false }
        },
        y: {
          min: DIGEST_Y_AXIS_MIN,
          title: {
            display: true,
            text: 'Avg ATH ×',
            color: TICK,
            font: { size: 11, weight: 600 }
          },
          grid: { color: GRID, drawBorder: false },
          ticks: { color: TICK, font: { size: 11, weight: 500 }, padding: 6 },
          border: { display: false }
        }
      },
      layout: { padding: { top: 36, right: 18, bottom: 8, left: 12 } }
    }
  };

  const out = await canvas30.renderToBuffer(configuration, 'image/png');
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

module.exports = {
  buildWeeklyAvgXpDigestPng,
  buildMonthlyAvgXpDigestPng,
  buildPast30DaysDigestPng
};
