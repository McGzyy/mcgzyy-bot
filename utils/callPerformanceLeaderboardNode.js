'use strict';

const { createClient } = require('@supabase/supabase-js');

const CALL_PERFORMANCE_VISIBLE_ON_DASHBOARD_OR =
  'hidden_from_dashboard.is.null,hidden_from_dashboard.eq.false';
const CALL_PERFORMANCE_NOT_EXCLUDED_FROM_STATS_OR =
  'excluded_from_stats.is.null,excluded_from_stats.eq.false';

function getSupabaseServiceRole() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

/** @param {unknown} row */
function rowCallTimeUtcMs(row) {
  const t = row && /** @type {{ call_time?: unknown }} */ (row).call_time;
  if (typeof t === 'number' && Number.isFinite(t)) return t;
  if (typeof t === 'string') {
    const parsed = Date.parse(t);
    if (Number.isFinite(parsed)) return parsed;
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/** @param {unknown} row */
function rowAthMultiple(row) {
  const ath =
    typeof (row && /** @type {{ ath_multiple?: unknown }} */ (row).ath_multiple) === 'number' &&
    Number.isFinite(/** @type {number} */ (row && row.ath_multiple))
      ? /** @type {number} */ (row.ath_multiple)
      : Number((row && row.ath_multiple) || 0);
  return Number.isFinite(ath) && ath > 0 ? ath : 0;
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {number} minCallTimeMs
 * @param {number} endMsExclusive
 */
function filterRowsByCallTimeWindow(rows, minCallTimeMs, endMsExclusive) {
  return rows.filter(row => {
    const t = rowCallTimeUtcMs(row);
    return t > 0 && t >= minCallTimeMs && t < endMsExclusive && Number.isFinite(endMsExclusive);
  });
}

/**
 * @param {Record<string, unknown>[]} rows
 */
function aggregateCallPerformanceRows(rows) {
  const sorted = [...rows].sort((a, b) => rowCallTimeUtcMs(a) - rowCallTimeUtcMs(b));
  /** @type {Map<string, { discord_id: string, username: string, totalCalls: number, sumX: number, wins: number, maxMultiple: number }>} */
  const map = new Map();

  for (const row of sorted) {
    if (row.excluded_from_stats === true) continue;
    if (row.hidden_from_dashboard === true) continue;
    const discordId =
      typeof row.discord_id === 'string'
        ? row.discord_id.trim()
        : String(row.discord_id ?? '').trim();
    if (!discordId) continue;

    const mult = rowAthMultiple(row);
    if (!Number.isFinite(mult) || mult <= 0) continue;

    let user = map.get(discordId);
    if (!user) {
      user = {
        discord_id: discordId,
        username: '',
        totalCalls: 0,
        sumX: 0,
        wins: 0,
        maxMultiple: mult
      };
      map.set(discordId, user);
    }

    user.totalCalls += 1;
    user.sumX += mult;
    if (mult >= 2) user.wins += 1;
    if (mult > user.maxMultiple) user.maxMultiple = mult;
    user.username = typeof row.username === 'string' ? row.username.trim() : '';
  }

  const results = [...map.values()].map(user => ({
    discordId: user.discord_id,
    username: user.username || user.discord_id,
    avgX: user.sumX / user.totalCalls,
    totalCalls: user.totalCalls,
    wins: user.wins,
    bestMultiple: user.maxMultiple
  }));

  results.sort((a, b) => b.avgX - a.avgX);
  return results;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} source
 */
async function fetchCallPerformanceForSource(sb, source) {
  const { data, error } = await sb
    .from('call_performance')
    .select('*')
    .eq('source', source)
    .or(CALL_PERFORMANCE_VISIBLE_ON_DASHBOARD_OR)
    .or(CALL_PERFORMANCE_NOT_EXCLUDED_FROM_STATS_OR);

  if (error) {
    return { rows: [], error: new Error(error.message) };
  }
  const rows = Array.isArray(data) ? /** @type {Record<string, unknown>[]} */ (data) : [];
  return { rows, error: null };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} source
 * @param {number} minCallTimeMs
 * @param {number} endMsExclusive
 */
async function getTopLeaderInCallTimeWindow(sb, source, minCallTimeMs, endMsExclusive) {
  const { rows, error } = await fetchCallPerformanceForSource(sb, source);
  if (error) throw error;
  const filtered = filterRowsByCallTimeWindow(rows, minCallTimeMs, endMsExclusive);
  const agg = aggregateCallPerformanceRows(filtered);
  return agg[0] ?? null;
}

/**
 * Best single call row in window (by ATH multiple).
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} source
 * @param {number} minCallTimeMs
 * @param {number} endMsExclusive
 */
async function getBestCallRowInCallTimeWindow(sb, source, minCallTimeMs, endMsExclusive) {
  const { rows, error } = await fetchCallPerformanceForSource(sb, source);
  if (error) throw error;
  const filtered = filterRowsByCallTimeWindow(rows, minCallTimeMs, endMsExclusive);
  let best = null;
  let bestM = -1;
  for (const row of filtered) {
    if (row.excluded_from_stats === true) continue;
    if (row.hidden_from_dashboard === true) continue;
    const m = rowAthMultiple(row);
    if (m > bestM) {
      bestM = m;
      best = row;
    }
  }
  return best;
}

function startOfWeekMondayUtcMs(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const dow = d.getUTCDay();
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  return Date.UTC(y, month, day - daysFromMonday, 0, 0, 0, 0);
}

function startOfCalendarMonthUtcMs(nowMs = Date.now()) {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0);
}

/** Previous calendar month (year + 0–11 month index). */
function previousUtcYearMonth(anchor = new Date()) {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();
  if (m === 0) return { y: y - 1, m: 11 };
  return { y, m: m - 1 };
}

function monthLabelUtc(y, m0) {
  return new Date(Date.UTC(y, m0, 15)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function periodKeyUtc(y, m0) {
  return `${y}-${String(m0 + 1).padStart(2, '0')}`;
}

module.exports = {
  getSupabaseServiceRole,
  getTopLeaderInCallTimeWindow,
  getBestCallRowInCallTimeWindow,
  fetchCallPerformanceForSource,
  aggregateCallPerformanceRows,
  filterRowsByCallTimeWindow,
  rowCallTimeUtcMs,
  rowAthMultiple,
  startOfWeekMondayUtcMs,
  startOfCalendarMonthUtcMs,
  previousUtcYearMonth,
  monthLabelUtc,
  periodKeyUtc
};
