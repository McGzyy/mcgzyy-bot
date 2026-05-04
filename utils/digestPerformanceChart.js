'use strict';

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const {
  getPreviousCompletedUtcWeekBounds,
  getAvgAthXByUtcWeekdayInBounds,
  getAvgAthXByUtcMonthInYear
} = require('./callerStatsService');

const WIDTH = 920;
const HEIGHT = 480;
/** Pure black canvas — matches X / terminal hero look. */
const BG = '#000000';
/** Readable on black (zinc-200-ish). */
const TICK = 'rgba(228, 228, 231, 0.78)';
const GRID = 'rgba(255, 255, 255, 0.06)';
const TITLE = '#fafafa';
/** Member series — cobalt blue (high contrast on black). */
const LINE_MEMBER = '#1a7cff';
const FILL_MEMBER = 'rgba(26, 124, 255, 0.14)';
/** McGBot series — same green as dashboard `--accent` (globals.css). */
const LINE_BOT = '#22c55e';
const FILL_BOT = 'rgba(34, 197, 94, 0.12)';
const POINT_RING = 'rgba(255, 255, 255, 0.35)';

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

const UTC_MO = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
];

/** @param {Date} startInclusive @param {Date} endExclusive */
function formatUtcWeekSubtitle(startInclusive, endExclusive) {
  const lastDay = new Date(endExclusive.getTime() - 86400000);
  const sm = UTC_MO[startInclusive.getUTCMonth()];
  const sd = startInclusive.getUTCDate();
  const em = UTC_MO[lastDay.getUTCMonth()];
  const ed = lastDay.getUTCDate();
  const y = startInclusive.getUTCFullYear();
  const y2 = lastDay.getUTCFullYear();
  if (y === y2 && startInclusive.getUTCMonth() === lastDay.getUTCMonth()) {
    return `${sm} ${sd}–${ed}, ${y} UTC`;
  }
  if (y === y2) {
    return `${sm} ${sd}–${em} ${ed}, ${y} UTC`;
  }
  const yShort = String(y).slice(-2);
  const y2Short = String(y2).slice(-2);
  return `${sm} ${sd} '${yShort} – ${em} ${ed} '${y2Short} UTC`;
}

/**
 * Line chart: Mon–Sun vs avg ATH × for member vs McGBot calls (last **completed** UTC week).
 * @param {Date} [fromDate] anchor (default now)
 * @returns {Promise<Buffer>}
 */
async function buildWeeklyAvgXpDigestPng(fromDate = new Date()) {
  const { startInclusive, endExclusive } = getPreviousCompletedUtcWeekBounds(fromDate);
  const { memberAvg, botAvg } = getAvgAthXByUtcWeekdayInBounds(startInclusive, endExclusive);
  const subtitle = formatUtcWeekSubtitle(startInclusive, endExclusive);

  const toPts = (arr) =>
    arr.map(v => (v == null || !Number.isFinite(Number(v)) ? null : Number(Number(v).toFixed(3))));

  const configuration = {
    type: 'line',
    data: {
      labels: WEEKDAY_LABELS,
      datasets: [
        {
          label: 'Member calls',
          data: toPts(memberAvg),
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
          data: toPts(botAvg),
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
        title: {
          display: true,
          text: `Avg ATH × by weekday (UTC) · ${subtitle}`,
          color: '#e2e8f0',
          font: { size: 13, weight: 600 },
          padding: { top: 8, bottom: 10 }
        },
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: TICK, boxWidth: 14, padding: 16, font: { size: 11 } }
        }
      },
      scales: {
        x: {
          grid: { color: GRID, drawBorder: false },
          ticks: { color: TICK, font: { size: 11, weight: 500 }, padding: 6 },
          border: { display: false }
        },
        y: {
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
      layout: { padding: { top: 6, right: 16, bottom: 10, left: 12 } }
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

  const configuration = {
    type: 'line',
    data: {
      labels: MONTH_LABELS,
      datasets: [
        {
          label: 'Member calls',
          data: toPts(memberAvg),
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
          data: toPts(botAvg),
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
        title: {
          display: true,
          text: `Avg ATH × by month (UTC) · ${y}`,
          color: TITLE,
          font: { size: 14, weight: 700 },
          padding: { top: 10, bottom: 12 }
        },
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            color: TICK,
            boxWidth: 18,
            padding: 18,
            font: { size: 12, weight: 600 },
            usePointStyle: true,
            pointStyle: 'rectRounded'
          }
        }
      },
      scales: {
        x: {
          grid: { color: GRID, drawBorder: false },
          ticks: { color: TICK, font: { size: 10, weight: 500 }, maxRotation: 0, padding: 6 },
          border: { display: false }
        },
        y: {
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
      layout: { padding: { top: 6, right: 16, bottom: 10, left: 12 } }
    }
  };

  const out = await chartCanvas.renderToBuffer(configuration, 'image/png');
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

module.exports = {
  buildWeeklyAvgXpDigestPng,
  buildMonthlyAvgXpDigestPng
};
