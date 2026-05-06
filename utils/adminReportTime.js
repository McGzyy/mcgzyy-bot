'use strict';

const MS_DAY = 24 * 60 * 60 * 1000;
const MS_WEEK = 7 * MS_DAY;

/**
 * @param {string} tz
 * @returns {boolean}
 */
function isValidTimeZone(tz) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Strip quotes; map friendly names; fix spaces in IANA segments (e.g. America/Los Angeles). */
function normalizeAdminTimezoneInput(raw) {
  let s = String(raw || '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '');
  if (!s) return '';
  const compact = s.toLowerCase().replace(/\s+/g, ' ').trim();
  const aliases = {
    'los angeles': 'America/Los_Angeles',
    la: 'America/Los_Angeles',
    pacific: 'America/Los_Angeles',
    'us/pacific': 'America/Los_Angeles',
    pst: 'America/Los_Angeles',
    pdt: 'America/Los_Angeles',
    pt: 'America/Los_Angeles',
    chicago: 'America/Chicago',
    'new york': 'America/New_York',
    eastern: 'America/New_York',
    est: 'America/New_York',
    edt: 'America/New_York',
    et: 'America/New_York',
    denver: 'America/Denver',
    phoenix: 'America/Phoenix',
    utc: 'UTC',
    gmt: 'UTC'
  };
  if (aliases[compact]) return aliases[compact];
  const slash = s.indexOf('/');
  if (slash > 0) {
    const region = s.slice(0, slash);
    const loc = s.slice(slash + 1).replace(/\s+/g, '_');
    const candidate = `${region}/${loc}`;
    if (candidate !== s && isValidTimeZone(candidate)) return candidate;
  }
  return s;
}

function resolveAdminTimeZone() {
  const rawEnv =
    String(process.env.ADMIN_REPORT_TIMEZONE || process.env.ADMIN_REPORT_TZ || '').trim();
  const normalized = normalizeAdminTimezoneInput(rawEnv);
  const tz = normalized || 'America/Chicago';
  return isValidTimeZone(tz) ? tz : 'UTC';
}

function resolveLocalReportHour() {
  const n = Number(process.env.ADMIN_REPORT_LOCAL_HOUR ?? 9);
  if (!Number.isFinite(n)) return 9;
  return Math.min(23, Math.max(0, Math.floor(n)));
}

/** @returns {{ y: number, m: number, d: number, h: number, mi: number, s: number }} */
function wallPartsAt(ms, timeZone) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = f.formatToParts(new Date(ms));
  const get = t => Number(parts.find(p => p.type === t)?.value || '0');
  return {
    y: get('year'),
    m: get('month'),
    d: get('day'),
    h: get('hour'),
    mi: get('minute'),
    s: get('second')
  };
}

function cmpWallTuple(w, y, m, d, h, mi, s) {
  const xs = [w.y - y, w.m - m, w.d - d, w.h - h, w.mi - mi, w.s - s];
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] !== 0) return xs[i] > 0 ? 1 : -1;
  }
  return 0;
}

function gregorianToJDN(year, month, day) {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const mo = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * mo + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

function jdnToGregorian(jdn) {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  return { year, month, day };
}

function calendarMinusDays(year, month, day, deltaDays) {
  const jdn = gregorianToJDN(year, month, day) - deltaDays;
  return jdnToGregorian(jdn);
}

/** Days to subtract from wall date to reach Monday (weekStartsOn Monday). */
function daysSinceMonday(weekdayLong) {
  const map = {
    Monday: 0,
    Tuesday: 1,
    Wednesday: 2,
    Thursday: 3,
    Friday: 4,
    Saturday: 5,
    Sunday: 6
  };
  return map[String(weekdayLong)] ?? 0;
}

/**
 * Earliest UTC instant whose wall clock in `timeZone` equals y-m-d hh:mi:ss.
 */
function utcMillisForZonedWallClock(y, m, d, hh, mi, ss, timeZone) {
  let lo = Date.UTC(y, m - 1, d, hh, mi, ss) - 4 * MS_DAY;
  let hi = Date.UTC(y, m - 1, d, hh, mi, ss) + 4 * MS_DAY;
  let best = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const cmp = cmpWallTuple(wallPartsAt(mid, timeZone), y, m, d, hh, mi, ss);
    if (cmp === 0) {
      best = mid;
      hi = mid - 1;
    } else if (cmp < 0) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best !== null) return best;

  const anchor = Date.UTC(y, m - 1, d, 12, 0, 0);
  for (let delta = -96 * 60 * 60 * 1000; delta <= 96 * 60 * 60 * 1000; delta += 60000) {
    const ms = anchor + delta;
    if (cmpWallTuple(wallPartsAt(ms, timeZone), y, m, d, hh, mi, ss) === 0) return ms;
  }
  return Date.UTC(y, m - 1, d, hh, mi, ss);
}

function formatInTimeZone(ms, timeZone, pattern) {
  const d = new Date(ms);
  if (pattern === 'yyyy-MM-dd') {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parts = f.formatToParts(d);
    const get = t => parts.find(p => p.type === t)?.value || '';
    const y = get('year');
    const mo = get('month');
    const da = get('day');
    return `${y}-${mo}-${da}`;
  }
  if (pattern === 'yyyy-MM-dd HH:mm') {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = f.formatToParts(d);
    const get = t => parts.find(p => p.type === t)?.value || '';
    const hh = String(get('hour')).padStart(2, '0');
    const mm = String(get('minute')).padStart(2, '0');
    return `${get('year')}-${get('month')}-${get('day')} ${hh}:${mm}`;
  }
  throw new Error(`unsupported pattern ${pattern}`);
}

/**
 * UTC ms for start of calendar month in `timeZone` (wall-clock 00:00).
 */
function startOfZonedMonthUtcMs(nowMs, timeZone) {
  const w = wallPartsAt(nowMs, timeZone);
  return utcMillisForZonedWallClock(w.y, w.m, 1, 0, 0, 0, timeZone);
}

/**
 * UTC ms for start of calendar day in `timeZone` (wall-clock 00:00).
 */
function startOfZonedDayUtcMs(nowMs, timeZone) {
  const w = wallPartsAt(nowMs, timeZone);
  return utcMillisForZonedWallClock(w.y, w.m, w.d, 0, 0, 0, timeZone);
}

/**
 * UTC ms for start of calendar week in `timeZone` (wall-clock 00:00, Monday start).
 */
function startOfZonedWeekUtcMs(nowMs, timeZone) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long'
  });
  const parts = f.formatToParts(new Date(nowMs));
  const get = t => parts.find(p => p.type === t)?.value || '';
  const weekday = String(get('weekday'));
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const back = daysSinceMonday(weekday);
  const mon = calendarMinusDays(year, month, day, back);
  return utcMillisForZonedWallClock(mon.year, mon.month, mon.day, 0, 0, 0, timeZone);
}

/**
 * @param {'daily' | 'weekly' | 'monthly'} kind
 * @param {number} nowMs
 * @param {string} timeZone
 * @returns {{ sinceMs: number, untilMs: number, label: string }}
 */
function resolveReportWindow(kind, nowMs, timeZone) {
  const untilMs = nowMs;
  if (kind === 'daily') {
    const sinceMs = startOfZonedDayUtcMs(nowMs, timeZone);
    const label = `Today · ${formatInTimeZone(sinceMs, timeZone, 'yyyy-MM-dd')} 00:00 → ${formatInTimeZone(untilMs, timeZone, 'yyyy-MM-dd HH:mm')} (${timeZone})`;
    return { sinceMs, untilMs, label };
  }
  if (kind === 'weekly') {
    const sinceMs = startOfZonedWeekUtcMs(nowMs, timeZone);
    const label = `Week-to-date · ${formatInTimeZone(sinceMs, timeZone, 'yyyy-MM-dd')} 00:00 → ${formatInTimeZone(untilMs, timeZone, 'yyyy-MM-dd HH:mm')} (${timeZone})`;
    return { sinceMs, untilMs, label };
  }
  const sinceMs = startOfZonedMonthUtcMs(nowMs, timeZone);
  const label = `Month-to-date · ${formatInTimeZone(sinceMs, timeZone, 'yyyy-MM-dd')} 00:00 → ${formatInTimeZone(untilMs, timeZone, 'yyyy-MM-dd HH:mm')} (${timeZone})`;
  return { sinceMs, untilMs, label };
}

/**
 * Wall-clock parts in timeZone for scheduling.
 */
function zonedWallParts(ms, timeZone) {
  const d = new Date(ms);
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = f.formatToParts(d);
  const get = t => parts.find(p => p.type === t)?.value || '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const weekday = String(get('weekday'));
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const ymd = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  return { year, month, day, weekday, hour, minute, ymd, ym };
}

module.exports = {
  MS_DAY,
  MS_WEEK,
  resolveAdminTimeZone,
  resolveLocalReportHour,
  startOfZonedMonthUtcMs,
  startOfZonedDayUtcMs,
  startOfZonedWeekUtcMs,
  resolveReportWindow,
  zonedWallParts,
  isValidTimeZone
};
