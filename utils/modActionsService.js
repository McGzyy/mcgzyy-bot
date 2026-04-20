'use strict';

const path = require('path');
const { readJson, writeJson } = require('./jsonStore');
const withJsonFile = writeJson.withFileLock;

const MOD_ACTIONS_PATH = path.join(__dirname, '../data/modActions.json');

const VALID_TYPES = new Set([
  'coin',
  'x_verify',
  'premium',
  'dev',
  'coin_deny',
  'coin_exclude',
  'x_verify_deny'
]);

/**
 * Append a moderator action record (queued, atomic write via jsonStore).
 * Fire-and-forget: do not await from approval handlers; failures are logged only.
 * Each row includes dedupeKey so double-delivery of the same Discord interaction
 * does not create duplicate rows.
 * @param {{ moderatorId: string, actionType: string, timestamp?: string, dedupeKey: string }} entry
 */
function recordModAction(entry) {
  const actionType = String(entry.actionType || '');
  const dedupeKey = String(entry.dedupeKey || '');
  const moderatorId = String(entry.moderatorId || '');

  if (!VALID_TYPES.has(actionType) || !dedupeKey || !moderatorId) {
    console.error('[ModActions] Invalid recordModAction entry');
    return;
  }

  const row = {
    moderatorId,
    actionType,
    timestamp: entry.timestamp || new Date().toISOString(),
    dedupeKey
  };

  withJsonFile(MOD_ACTIONS_PATH, async ({ readParsed, writeParsed }) => {
    let root;
    try {
      root = await readParsed();
    } catch (e) {
      const code = e && /** @type {{ code?: string }} */ (e).code;
      if (code === 'ENOENT') {
        root = { actions: [] };
      } else {
        console.error('[ModActions] read/parse failed, skipping append:', e.message || e);
        return;
      }
    }

    const actions = Array.isArray(root?.actions) ? root.actions : [];
    const seen = new Set(actions.map(a => a && a.dedupeKey).filter(Boolean));
    if (seen.has(dedupeKey)) {
      return;
    }

    actions.push(row);
    await writeParsed({ actions });
  }).catch(err => {
    console.error('[ModActions] Failed to record:', err.message || err);
  });
}

/**
 * @typedef {{ approvals: number, denies: number, excludes: number, other: number, total: number }} ModStatBuckets
 */

const APPROVAL_TYPES = new Set(['coin', 'premium']);

/** @param {string} actionType */
function bucketModAction(actionType) {
  if (APPROVAL_TYPES.has(actionType)) return 'approvals';
  if (actionType === 'coin_deny') return 'denies';
  if (actionType === 'coin_exclude') return 'excludes';
  return 'other';
}

/** @returns {ModStatBuckets} */
function emptyBuckets() {
  return { approvals: 0, denies: 0, excludes: 0, other: 0, total: 0 };
}

/** @param {ModStatBuckets} b @param {string} bucket */
function bumpBucket(b, bucket) {
  if (bucket === 'approvals') b.approvals += 1;
  else if (bucket === 'denies') b.denies += 1;
  else if (bucket === 'excludes') b.excludes += 1;
  else b.other += 1;
  b.total += 1;
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Summarize modActions.json for dashboard staff sidebar (site-wide + optional viewer-only).
 * @param {string} [viewerModeratorId] Discord user id — when set, includes `yours` buckets.
 * @returns {Promise<{ site: { month: ModStatBuckets, allTime: ModStatBuckets }, yours?: { month: ModStatBuckets, allTime: ModStatBuckets }, actionCount: number, generatedAt: string }>}
 */
async function getModActionStatsSummary(viewerModeratorId) {
  let root;
  try {
    root = await readJson(MOD_ACTIONS_PATH);
  } catch (e) {
    const code = e && /** @type {{ code?: string }} */ (e).code;
    if (code === 'ENOENT') {
      const empty = emptyBuckets();
      const base = {
        site: { month: { ...empty }, allTime: { ...empty } },
        actionCount: 0,
        generatedAt: new Date().toISOString()
      };
      const vid = String(viewerModeratorId || '').trim();
      if (vid) {
        return {
          ...base,
          yours: { month: { ...empty }, allTime: { ...empty } }
        };
      }
      return base;
    }
    throw e;
  }

  const actions = Array.isArray(root?.actions) ? root.actions : [];
  const now = Date.now();
  const monthCut = now - MONTH_MS;

  const siteMonth = emptyBuckets();
  const siteAll = emptyBuckets();
  const vid = String(viewerModeratorId || '').trim();
  const youMonth = vid ? emptyBuckets() : null;
  const youAll = vid ? emptyBuckets() : null;

  for (const a of actions) {
    if (!a || typeof a !== 'object') continue;
    const actionType = String(a.actionType || '').trim();
    if (!VALID_TYPES.has(actionType)) continue;
    const ts = Date.parse(String(a.timestamp || '')) || 0;
    const bucket = bucketModAction(actionType);
    const mid = String(a.moderatorId || '').trim();

    bumpBucket(siteAll, bucket);
    if (ts >= monthCut) bumpBucket(siteMonth, bucket);

    if (vid && mid === vid && youMonth && youAll) {
      bumpBucket(youAll, bucket);
      if (ts >= monthCut) bumpBucket(youMonth, bucket);
    }
  }

  const out = {
    site: { month: siteMonth, allTime: siteAll },
    actionCount: actions.length,
    generatedAt: new Date().toISOString()
  };
  if (vid && youMonth && youAll) {
    return { ...out, yours: { month: youMonth, allTime: youAll } };
  }
  return out;
}

module.exports = {
  recordModAction,
  MOD_ACTIONS_PATH,
  getModActionStatsSummary
};
