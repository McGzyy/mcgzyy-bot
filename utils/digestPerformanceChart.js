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
/** Card embed: near-black to blend with digest panel gradient. */
const CARD_EMBED_BG = '#05050c';
/** Readable on black (zinc-200-ish). */
const TICK = 'rgba(228, 228, 231, 0.88)';
const GRID = 'rgba(255, 255, 255, 0.11)';
/** Member series — cobalt blue (high contrast on black). */
const LINE_MEMBER = '#1a7cff';
const FILL_MEMBER = 'rgba(26, 124, 255, 0.14)';
/** McGBot series — same green as dashboard `--accent` (globals.css). */
const LINE_BOT = '#22c55e';
const FILL_BOT = 'rgba(34, 197, 94, 0.12)';
const POINT_RING = 'rgba(255, 255, 255, 0.35)';

/** Modest ATH × when a UTC weekday had no qualifying prints (standalone charts only). */
const DIGEST_PLACEHOLDER_ATH_X = 1.68;
/** Standalone digest charts without embed mode. */
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

/**
 * @param {{ forCardEmbed?: boolean, chartBackground?: string }} opts
 */
function digestChartBackground(opts = {}) {
  if (opts.forCardEmbed === true) {
    const custom = opts.chartBackground;
    return typeof custom === 'string' && custom.trim() ? custom.trim() : CARD_EMBED_BG;
  }
  return BG;
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

/**
 * @param {(number|null|undefined)[]} pts one entry per UTC day in range
 */
function backfillDailyDigestPoints(pts) {
  return pts.map(v => {
    if (v != null && Number.isFinite(Number(v))) {
      return Number(Number(v).toFixed(3));
    }
    return DIGEST_PLACEHOLDER_ATH_X;
  });
}

/** Legend above plot — explicit fonts/colors so labels render in chartjs-node-canvas (no invisible text). */
function digestLegendPluginOptions(embed = false) {
  return {
    display: true,
    position: 'top',
    align: 'center',
    labels: {
      color: TICK,
      padding: embed ? 6 : 16,
      boxWidth: embed ? 12 : 14,
      boxHeight: embed ? 12 : 14,
      usePointStyle: true,
      pointStyle: 'rect',
      font: {
        size: embed ? 12 : 14,
        weight: '600',
        family: 'Arial, Helvetica, sans-serif'
      }
    }
  };
}

/** Tight insets so card-embed charts use most of the PNG height. */
function digestCardEmbedLayoutPadding() {
  return { top: 18, right: 8, bottom: 6, left: 2 };
}

/**
 * @param {Array<Array<number|null|undefined>>} seriesLists
 * @returns {{ min: number, max: number }}
 */
function digestYScaleFromSeries(...seriesLists) {
  const vals = seriesLists
    .flat()
    .filter(v => v != null && Number.isFinite(Number(v)))
    .map(v => Number(v));
  if (!vals.length) {
    return { min: 1, max: 3.5 };
  }
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  let span = hi - lo;
  if (span < 0.25) {
    lo -= 0.2;
    hi += 0.2;
    span = hi - lo;
  }
  const pad = Math.max(0.18, span * 0.14);
  return { min: Math.max(0, lo - pad), max: hi + pad };
}

/**
 * @param {{ min: number, max: number }} scale
 * @param {boolean} embed
 */
function digestYAxisOptions(scale, embed = false) {
  return {
    min: scale.min,
    max: scale.max,
    title: {
      display: true,
      text: 'Avg ATH ×',
      color: TICK,
      font: { size: embed ? 12 : 11, weight: '600' }
    },
    grid: { color: GRID, drawBorder: false },
    ticks: {
      color: TICK,
      font: { size: embed ? 11 : 11, weight: '500' },
      padding: embed ? 4 : 8,
      maxTicksLimit: embed ? 6 : 8
    },
    border: { display: false }
  };
}

/**
 * @param {boolean} embed
 */
function digestLineDatasetStyle(embed) {
  return {
    borderWidth: embed ? 4 : 3,
    tension: embed ? 0.28 : 0.35,
    pointRadius: embed ? 5 : 4,
    pointHoverRadius: embed ? 7 : 6,
    pointBorderWidth: embed ? 2 : 1.5
  };
}

/**
 * Line chart: Mon–Sun vs avg ATH × for member vs McGBot calls (last **completed** UTC week).
 * @param {Date} [fromDate] anchor (default now)
 * @returns {Promise<Buffer>}
 */
async function buildWeeklyAvgXpDigestPng(fromDate = new Date(), opts = {}) {
  const embed = opts.forCardEmbed === true;
  const chartW = Number(opts.width) > 0 ? Number(opts.width) : WIDTH;
  const chartH = Number(opts.height) > 0 ? Number(opts.height) : HEIGHT;
  let memberAvg;
  let botAvg;
  if (opts.useRollingWindow === true) {
    const series = getAvgAthXLastNUtcDaysBeforeAnchor(fromDate, 7);
    memberAvg = series.memberAvg;
    botAvg = series.botAvg;
  } else {
    const { startInclusive, endExclusive } = getPreviousCompletedUtcWeekBounds(fromDate);
    const series = getAvgAthXByUtcWeekdayInBounds(startInclusive, endExclusive);
    memberAvg = series.memberAvg;
    botAvg = series.botAvg;
  }

  const toPts = (arr) =>
    arr.map(v => (v == null || !Number.isFinite(Number(v)) ? null : Number(Number(v).toFixed(3))));

  const rawMember = toPts(memberAvg);
  const rawBot = toPts(botAvg);
  const memberPts = embed ? rawMember : backfillWeekDigestPoints(rawMember);
  const botPts = embed ? rawBot : backfillWeekDigestPoints(rawBot);
  const yScale = embed ? digestYScaleFromSeries(memberPts, botPts) : { min: DIGEST_Y_AXIS_MIN, max: null };
  const lineStyle = digestLineDatasetStyle(embed);

  const embedBg = digestChartBackground(opts);
  const canvas =
    chartW === WIDTH && chartH === HEIGHT && !embed
      ? chartCanvas
      : new ChartJSNodeCanvas({
          width: chartW,
          height: chartH,
          backgroundColour: embed ? embedBg : BG,
          chartCallback: digestChartCallback
        });

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
          ...lineStyle,
          spanGaps: embed,
          pointBackgroundColor: LINE_MEMBER,
          pointBorderColor: POINT_RING
        },
        {
          label: 'McGBot calls',
          data: botPts,
          borderColor: LINE_BOT,
          backgroundColor: FILL_BOT,
          ...lineStyle,
          spanGaps: embed,
          pointBackgroundColor: LINE_BOT,
          pointBorderColor: POINT_RING
        }
      ]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        title: { display: false },
        legend: digestLegendPluginOptions(embed)
      },
      scales: {
        x: {
          grid: { color: GRID, drawBorder: false },
          ticks: {
            color: TICK,
            font: { size: embed ? 11 : 11, weight: 500 },
            padding: embed ? 4 : 8
          },
          border: { display: false }
        },
        y: embed
          ? digestYAxisOptions(yScale, true)
          : {
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
      layout: {
        padding: embed ? digestCardEmbedLayoutPadding() : { top: 44, right: 16, bottom: 10, left: 12 }
      }
    }
  };

  const out = await canvas.renderToBuffer(configuration, 'image/png');
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
      layout: { padding: { top: 44, right: 16, bottom: 10, left: 12 } }
    }
  };

  const out = await chartCanvas.renderToBuffer(configuration, 'image/png');
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

const WIDTH_30D = 1000;

/**
 * @param {(number|null|undefined)[]} pts
 * @param {{ skipPlaceholder?: boolean }} [opts]
 */
function digestDailyPoints(pts, opts = {}) {
  if (opts.skipPlaceholder) {
    return pts.map(v =>
      v != null && Number.isFinite(Number(v)) ? Number(Number(v).toFixed(3)) : null
    );
  }
  return backfillDailyDigestPoints(pts);
}

/**
 * Last `nDays` full UTC days (ending yesterday vs `anchor`) — member vs McGBot avg ATH × per day.
 * @param {Date} [anchor]
 * @param {number} [nDays]
 * @param {{ skipPlaceholder?: boolean, width?: number, height?: number }} [opts]
 * @returns {Promise<Buffer>}
 */
async function buildPast30DaysDigestPng(anchor = new Date(), nDays = 30, opts = {}) {
  const { labels, memberAvg, botAvg } = getAvgAthXLastNUtcDaysBeforeAnchor(anchor, nDays);
  const embed = opts.forCardEmbed === true || opts.skipPlaceholder === true;
  const memberPts = digestDailyPoints(memberAvg, { skipPlaceholder: embed });
  const botPts = digestDailyPoints(botAvg, { skipPlaceholder: embed });
  const yScale = embed ? digestYScaleFromSeries(memberPts, botPts) : { min: DIGEST_Y_AXIS_MIN, max: null };
  const lineStyle = digestLineDatasetStyle(embed);
  const chartW = Number(opts.width) > 0 ? Number(opts.width) : WIDTH_30D;
  const chartH = Number(opts.height) > 0 ? Number(opts.height) : HEIGHT;

  const embedBg = digestChartBackground(opts);
  const canvas30 = new ChartJSNodeCanvas({
    width: chartW,
    height: chartH,
    backgroundColour: embed ? embedBg : BG,
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
          ...lineStyle,
          spanGaps: embed,
          pointRadius: embed ? 0 : 2,
          pointHoverRadius: 5,
          pointBackgroundColor: LINE_MEMBER,
          pointBorderColor: POINT_RING
        },
        {
          label: 'McGBot calls',
          data: botPts,
          borderColor: LINE_BOT,
          backgroundColor: FILL_BOT,
          ...lineStyle,
          spanGaps: embed,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointBackgroundColor: LINE_BOT,
          pointBorderColor: POINT_RING
        }
      ]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        title: { display: false },
        legend: digestLegendPluginOptions(embed)
      },
      scales: {
        x: {
          grid: { color: GRID, drawBorder: false },
          ticks: {
            color: TICK,
            font: { size: embed ? 10 : 9, weight: 500 },
            padding: embed ? 4 : 6,
            maxRotation: embed ? 0 : 45,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: embed ? 10 : 12
          },
          border: { display: false }
        },
        y: embed
          ? digestYAxisOptions(yScale, true)
          : {
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
      layout: {
        padding: embed ? digestCardEmbedLayoutPadding() : { top: 44, right: 18, bottom: 8, left: 12 }
      }
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
