'use strict';

const path = require('path');
const { readJson, writeJson } = require('./jsonStore');

const AUDIT_PATH = path.join(__dirname, '../data/xPostAuditLog.json');
const MAX_EVENTS = 6000;

/**
 * @typedef {{
 *   ts: number,
 *   success: boolean,
 *   category: string,
 *   reply?: boolean,
 *   media?: boolean,
 *   callSourceType?: string | null,
 *   errorSnippet?: string | null
 * }} XPostAuditEvent
 */

/**
 * @param {unknown} err
 * @returns {string}
 */
function shortenError(err) {
  try {
    const s =
      typeof err === 'string'
        ? err
        : JSON.stringify(err);
    const t = String(s || '').slice(0, 400);
    return t.length >= 400 ? `${t}…` : t;
  } catch {
    return 'unknown_error';
  }
}

/**
 * Fire-and-forget append for X post outcomes (admin reports / ops visibility).
 * @param {Omit<XPostAuditEvent, 'ts'> & { ts?: number }} partial
 * @returns {Promise<void>}
 */
async function appendXPostAuditEvent(partial) {
  const row = {
    ts: Number.isFinite(Number(partial.ts)) ? Number(partial.ts) : Date.now(),
    success: partial.success === true,
    category: String(partial.category || 'unknown'),
    reply: Boolean(partial.reply),
    media: Boolean(partial.media),
    callSourceType:
      partial.callSourceType != null && partial.callSourceType !== ''
        ? String(partial.callSourceType)
        : null,
    errorSnippet: partial.errorSnippet != null ? String(partial.errorSnippet).slice(0, 500) : null
  };

  try {
    await writeJson.withFileLock(AUDIT_PATH, async ({ readParsed, writeParsed }) => {
      let root;
      try {
        root = await readParsed();
      } catch {
        root = { events: [] };
      }
      const events = Array.isArray(root?.events) ? root.events : [];
      events.push(row);
      while (events.length > MAX_EVENTS) {
        events.shift();
      }
      await writeParsed({ events });
    });
  } catch (e) {
    console.error('[XPostAudit] append failed:', e?.message || e);
  }
}

/**
 * @returns {Promise<XPostAuditEvent[]>}
 */
async function loadAllXPostAuditEvents() {
  try {
    const data = await readJson(AUDIT_PATH);
    return Array.isArray(data?.events) ? data.events : [];
  } catch (e) {
    const code = e && /** @type {{ code?: string }} */ (e).code;
    if (code === 'ENOENT') return [];
    console.error('[XPostAudit] read failed:', e?.message || e);
    return [];
  }
}

/**
 * @param {number} sinceMs
 * @param {number} [untilMs]
 * @returns {Promise<XPostAuditEvent[]>}
 */
async function loadXPostAuditEventsSince(sinceMs, untilMs = Date.now()) {
  const all = await loadAllXPostAuditEvents();
  return all.filter(e => {
    const t = Number(e.ts);
    return Number.isFinite(t) && t >= sinceMs && t <= untilMs;
  });
}

/**
 * @param {XPostAuditEvent[]} events
 */
function summarizeXPostAudit(events) {
  /** @type {Record<string, { ok: number, fail: number, mediaOk: number }>} */
  const byCat = {};
  const bump = (cat, ok, hadMedia) => {
    if (!byCat[cat]) byCat[cat] = { ok: 0, fail: 0, mediaOk: 0 };
    if (ok) {
      byCat[cat].ok += 1;
      if (hadMedia) byCat[cat].mediaOk += 1;
    } else byCat[cat].fail += 1;
  };

  let ok = 0;
  let fail = 0;
  let mediaOk = 0;
  let repliesOk = 0;

  for (const e of events) {
    const cat = String(e.category || 'unknown');
    const success = e.success === true;
    if (success) {
      ok += 1;
      if (e.media) mediaOk += 1;
      if (e.reply) repliesOk += 1;
    } else fail += 1;
    bump(cat, success, Boolean(e.media));
  }

  const milestoneUserSideOk =
    (byCat.milestone_user?.ok || 0) +
    (byCat.milestone_watch?.ok || 0);
  const milestoneUserSideFail =
    (byCat.milestone_user?.fail || 0) +
    (byCat.milestone_watch?.fail || 0);
  const milestoneBotOk = byCat.milestone_bot?.ok || 0;
  const milestoneBotFail = byCat.milestone_bot?.fail || 0;

  return {
    totalOk: ok,
    totalFail: fail,
    mediaOk,
    repliesOk,
    byCat,
    milestoneUserSideOk,
    milestoneUserSideFail,
    milestoneBotOk,
    milestoneBotFail
  };
}

module.exports = {
  appendXPostAuditEvent,
  shortenError,
  loadAllXPostAuditEvents,
  loadXPostAuditEventsSince,
  summarizeXPostAudit,
  AUDIT_PATH
};
