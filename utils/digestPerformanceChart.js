'use strict';

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const {
  getPreviousCompletedUtcWeekBounds,
  getAvgAthXByUtcWeekdayInBounds,
  getAvgAthXByUtcMonthInYear
} = require('./callerStatsService');

const WIDTH = 920;
const HEIGHT = 480;
const BG = '#0d1117';
const TICK = 'rgba(148, 163, 184, 0.85)';
const GRID = 'rgba(148, 163, 184, 0.1)';

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
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96, 165, 250, 0.08)',
          borderWidth: 2.5,
          tension: 0.25,
          spanGaps: false,
          pointRadius: 3,
          pointHoverRadius: 4
        },
        {
          label: 'McGBot calls',
          data: toPts(botAvg),
          borderColor: '#34d399',
          backgroundColor: 'rgba(52, 211, 153, 0.08)',
          borderWidth: 2.5,
          tension: 0.25,
          spanGaps: false,
          pointRadius: 3,
          pointHoverRadius: 4
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
          ticks: { color: TICK, font: { size: 11 } }
        },
        y: {
          title: {
            display: true,
            text: 'Avg ATH ×',
            color: TICK,
            font: { size: 11 }
          },
          grid: { color: GRID, drawBorder: false },
          ticks: { color: TICK, font: { size: 11 } }
        }
      },
      layout: { padding: { top: 4, right: 14, bottom: 8, left: 10 } }
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
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96, 165, 250, 0.08)',
          borderWidth: 2.5,
          tension: 0.2,
          spanGaps: false,
          pointRadius: 2.5,
          pointHoverRadius: 4
        },
        {
          label: 'McGBot calls',
          data: toPts(botAvg),
          borderColor: '#34d399',
          backgroundColor: 'rgba(52, 211, 153, 0.08)',
          borderWidth: 2.5,
          tension: 0.2,
          spanGaps: false,
          pointRadius: 2.5,
          pointHoverRadius: 4
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
          ticks: { color: TICK, font: { size: 10 }, maxRotation: 0 }
        },
        y: {
          title: {
            display: true,
            text: 'Avg ATH ×',
            color: TICK,
            font: { size: 11 }
          },
          grid: { color: GRID, drawBorder: false },
          ticks: { color: TICK, font: { size: 11 } }
        }
      },
      layout: { padding: { top: 4, right: 14, bottom: 8, left: 10 } }
    }
  };

  const out = await chartCanvas.renderToBuffer(configuration, 'image/png');
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

module.exports = {
  buildWeeklyAvgXpDigestPng,
  buildMonthlyAvgXpDigestPng
};
