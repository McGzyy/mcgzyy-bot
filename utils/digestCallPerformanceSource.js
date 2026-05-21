'use strict';

const {
  getSupabaseServiceRole,
  fetchCallPerformanceForSource,
  aggregateCallPerformanceRows,
  filterRowsByCallTimeWindow,
  rowAthMultiple
} = require('./callPerformanceLeaderboardNode');
const { getDigestWindowBounds, startOfUtcCalendarDay } = require('./callerStatsService');

/**
 * @param {Record<string, unknown>[]} rows
 */
function avgAthMultiple(rows) {
  const xs = [];
  for (const row of rows) {
    const m = rowAthMultiple(row);
    if (m > 0) xs.push(m);
  }
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * @param {Record<string, unknown>[]} rows
 */
function bestCallFromRows(rows) {
  let best = null;
  let bestM = -1;
  for (const row of rows) {
    const m = rowAthMultiple(row);
    if (m > bestM) {
      bestM = m;
      best = row;
    }
  }
  if (!best) return null;
  const ticker = String(best.token_ticker || best.token_name || '—')
    .trim()
    .replace(/^\$/, '');
  return { ticker: ticker || '—', x: bestM };
}

/**
 * @param {Record<string, unknown>[]} rows
 */
function cohortFromRows(rows) {
  const xs = rows.map(rowAthMultiple).filter(m => m > 0);
  const n = rows.length;
  if (!n) {
    return { count: 0, medianX: null, pctGe2: null, pctGe3: null };
  }
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianX =
    sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const pctGe2 = (100 * xs.filter(x => x >= 2).length) / xs.length;
  const pctGe3 = (100 * xs.filter(x => x >= 3).length) / xs.length;
  return { count: n, medianX, pctGe2, pctGe3 };
}

/**
 * @param {Record<string, unknown>[]} rows
 */
function uniqueCallersFromRows(rows) {
  const seen = new Set();
  for (const row of rows) {
    const id = String(row.discord_id || '').trim();
    if (id) seen.add(id);
  }
  return seen.size;
}

/**
 * @param {Date} endExclusiveDayStart
 * @param {number} n
 */
function listUtcDayBucketsBefore(endExclusiveDayStart, n) {
  const out = [];
  const end0 = startOfUtcCalendarDay(endExclusiveDayStart);
  for (let k = 0; k < n; k += 1) {
    const dayStart = new Date(end0);
    dayStart.setUTCDate(dayStart.getUTCDate() - (n - k));
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
      dayStart.getUTCMonth()
    ];
    out.push({
      startInclusive: dayStart,
      endExclusive: dayEnd,
      label: `${mo} ${dayStart.getUTCDate()}`
    });
  }
  return out;
}

/**
 * @param {Date} startInclusive
 * @param {Date} endExclusive
 */
function formatRangeLabelForCard(startInclusive, endExclusive) {
  const lastDay = new Date(endExclusive.getTime() - 86400000);
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const sm = mo[startInclusive.getUTCMonth()];
  const sd = startInclusive.getUTCDate();
  const em = mo[lastDay.getUTCMonth()];
  const ed = lastDay.getUTCDate();
  const y = startInclusive.getUTCFullYear();
  if (startInclusive.getUTCMonth() === lastDay.getUTCMonth() && y === lastDay.getUTCFullYear()) {
    return `${sm} ${sd}–${ed}, ${y}`;
  }
  return `${sm} ${sd} – ${em} ${ed}, ${y}`;
}

/**
 * @param {number} startMs
 * @param {number} endMs
 */
async function fetchDeskRowsInWindow(startMs, endMs) {
  const sb = getSupabaseServiceRole();
  if (!sb) return null;

  const [userRes, botRes] = await Promise.all([
    fetchCallPerformanceForSource(sb, 'user'),
    fetchCallPerformanceForSource(sb, 'bot')
  ]);

  if (userRes.error) {
    console.error('[DigestCP] user fetch:', userRes.error.message || userRes.error);
    return null;
  }
  if (botRes.error) {
    console.error('[DigestCP] bot fetch:', botRes.error.message || botRes.error);
    return null;
  }

  return {
    user: filterRowsByCallTimeWindow(userRes.rows, startMs, endMs),
    bot: filterRowsByCallTimeWindow(botRes.rows, startMs, endMs)
  };
}

/**
 * @param {number} startMs
 * @param {number} endMs
 */
async function countCallPerformanceDeskInWindow(startMs, endMs) {
  const w = await fetchDeskRowsInWindow(startMs, endMs);
  if (!w) return null;
  return { human: w.user.length, bot: w.bot.length, total: w.user.length + w.bot.length };
}

/**
 * Last N UTC days avg× series from call_performance (for rolling weekly chart).
 * @param {Date} anchor
 * @param {number} nDays
 * @param {Record<string, unknown>[]} allUser
 * @param {Record<string, unknown>[]} allBot
 */
function chartSeriesFromCallPerformance(anchor, nDays, allUser, allBot) {
  const buckets = listUtcDayBucketsBefore(anchor, nDays);
  const labels = buckets.map(b => b.label);
  const memberAvg = buckets.map(b => {
    const startMs = b.startInclusive.getTime();
    const endMs = b.endExclusive.getTime();
    const rows = filterRowsByCallTimeWindow(allUser, startMs, endMs);
    return avgAthMultiple(rows);
  });
  const botAvg = buckets.map(b => {
    const startMs = b.startInclusive.getTime();
    const endMs = b.endExclusive.getTime();
    const rows = filterRowsByCallTimeWindow(allBot, startMs, endMs);
    return avgAthMultiple(rows);
  });
  return { labels, memberAvg, botAvg };
}

/**
 * @param {'daily'|'weekly'|'monthly'} kind
 * @param {Date} anchor
 * @param {{ useRollingWindow?: boolean, useAllTimeWindow?: boolean }} opts
 */
async function buildDigestSnapshotFromCallPerformance(kind, anchor = new Date(), opts = {}) {
  const sb = getSupabaseServiceRole();
  if (!sb) return null;

  const bounds = getDigestWindowBounds(kind, anchor, {
    rolling: opts.useRollingWindow === true,
    allTime: opts.useAllTimeWindow === true
  });

  const startMs = bounds.startInclusive.getTime();
  const endMs = bounds.endExclusive.getTime();
  const priorStartMs = bounds.priorStart.getTime();
  const priorEndMs = bounds.priorEnd.getTime();

  const [cur, prior, userAll, botAll] = await Promise.all([
    fetchDeskRowsInWindow(startMs, endMs),
    fetchDeskRowsInWindow(priorStartMs, priorEndMs),
    fetchCallPerformanceForSource(sb, 'user'),
    fetchCallPerformanceForSource(sb, 'bot')
  ]);

  if (!cur) return null;

  const topN = kind === 'monthly' ? 8 : kind === 'daily' ? 5 : 5;
  const lb = aggregateCallPerformanceRows(cur.user).slice(0, topN);

  let dateLabel;
  if (bounds.mode === 'alltime') {
    dateLabel = 'All-time desk';
  } else if (bounds.mode === 'rolling') {
    dateLabel =
      kind === 'daily' ? 'Last 24h (rolling)' : kind === 'weekly' ? 'Last 7d (rolling)' : 'Last 30d (rolling)';
  } else if (kind === 'daily') {
    dateLabel = `UTC ${bounds.startInclusive.toISOString().slice(0, 10)}`;
  } else {
    dateLabel = formatRangeLabelForCard(bounds.startInclusive, bounds.endExclusive);
  }

  /** @type {{ labels?: string[], memberAvg?: (number|null)[], botAvg?: (number|null)[] }} */
  let chartSeries = {};
  if (kind === 'weekly' && opts.useRollingWindow === true && !userAll.error && !botAll.error) {
    chartSeries = chartSeriesFromCallPerformance(
      anchor,
      7,
      userAll.rows,
      botAll.rows
    );
  }

  return {
    dateLabel,
    isSample: false,
    dataSource: 'call_performance',
    memberAvgX: avgAthMultiple(cur.user),
    priorMemberAvgX: prior ? avgAthMultiple(prior.user) : null,
    botAvgX: avgAthMultiple(cur.bot),
    leaderboard: lb.map(r => ({
      username: r.username || 'Caller',
      discordId: r.discordId || null,
      avgX: r.avgX,
      totalCalls: r.totalCalls
    })),
    bestHuman: bestCallFromRows(cur.user),
    bestBot: bestCallFromRows(cur.bot),
    deskPulse:
      kind === 'daily'
        ? {
            dayLabel: bounds.startInclusive.toISOString().slice(0, 10),
            uniqueCallers: uniqueCallersFromRows(cur.user),
            user: cohortFromRows(cur.user),
            bot: cohortFromRows(cur.bot)
          }
        : undefined,
    chartSeries,
    deskCounts: {
      user: cur.user.length,
      bot: cur.bot.length
    }
  };
}

module.exports = {
  buildDigestSnapshotFromCallPerformance,
  countCallPerformanceDeskInWindow,
  fetchDeskRowsInWindow
};
