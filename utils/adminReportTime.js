'use strict';

const { startOfDay, startOfWeek, startOfMonth } = require('date-fns');
const { fromZonedTime, toZonedTime, formatInTimeZone } = require('date-fns-tz');

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

function resolveAdminTimeZone() {
  const raw = String(process.env.ADMIN_REPORT_TIMEZONE || '').trim();
  const tz = raw || 'America/Chicago';
  return isValidTimeZone(tz) ? tz : 'UTC';
}

function resolveLocalReportHour() {
  const n = Number(process.env.ADMIN_REPORT_LOCAL_HOUR ?? 9);
  if (!Number.isFinite(n)) return 9;
  return Math.min(23, Math.max(0, Math.floor(n)));
}

/**
 * UTC ms for start of calendar month in `timeZone` (wall-clock 00:00).
 * @param {number} nowMs
 * @param {string} timeZone
 */
function startOfZonedMonthUtcMs(nowMs, timeZone) {
  const anchor = new Date(nowMs);
  const zonedNow = toZonedTime(anchor, timeZone);
  const somLocal = startOfMonth(zonedNow);
  return fromZonedTime(somLocal, timeZone).getTime();
}

/**
 * UTC ms for start of calendar day in `timeZone` (wall-clock 00:00).
 * @param {number} nowMs
 * @param {string} timeZone
 */
function startOfZonedDayUtcMs(nowMs, timeZone) {
  const anchor = new Date(nowMs);
  const zonedNow = toZonedTime(anchor, timeZone);
  const sodLocal = startOfDay(zonedNow);
  return fromZonedTime(sodLocal, timeZone).getTime();
}

/**
 * UTC ms for start of calendar week in `timeZone` (wall-clock 00:00, Monday start).
 * @param {number} nowMs
 * @param {string} timeZone
 */
function startOfZonedWeekUtcMs(nowMs, timeZone) {
  const anchor = new Date(nowMs);
  const zonedNow = toZonedTime(anchor, timeZone);
  const sowLocal = startOfWeek(zonedNow, { weekStartsOn: 1 });
  return fromZonedTime(sowLocal, timeZone).getTime();
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
    const label = `Today · ${formatInTimeZone(new Date(sinceMs), timeZone, 'yyyy-MM-dd')} 00:00 → ${formatInTimeZone(new Date(untilMs), timeZone, 'yyyy-MM-dd HH:mm')} (${timeZone})`;
    return { sinceMs, untilMs, label };
  }
  if (kind === 'weekly') {
    const sinceMs = startOfZonedWeekUtcMs(nowMs, timeZone);
    const label = `Week-to-date · ${formatInTimeZone(new Date(sinceMs), timeZone, 'yyyy-MM-dd')} 00:00 → ${formatInTimeZone(new Date(untilMs), timeZone, 'yyyy-MM-dd HH:mm')} (${timeZone})`;
    return { sinceMs, untilMs, label };
  }
  const sinceMs = startOfZonedMonthUtcMs(nowMs, timeZone);
  const label = `Month-to-date · ${formatInTimeZone(new Date(sinceMs), timeZone, 'yyyy-MM-dd')} 00:00 → ${formatInTimeZone(new Date(untilMs), timeZone, 'yyyy-MM-dd HH:mm')} (${timeZone})`;
  return { sinceMs, untilMs, label };
}

/**
 * Wall-clock parts in timeZone for scheduling.
 * @param {number} ms
 * @param {string} timeZone
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
