/**
 * Persist processed X tweet / event IDs so live mention intake does not run twice for the same item.
 * Used by xCallIntakeService; no polling or posting here.
 */

const fs = require('fs');
const path = require('path');

const dedupeFilePath = path.join(__dirname, '../data/xIntakeProcessedTweetIds.json');

const DEFAULT_MAX_IDS = 20000;

function maxStoredIds() {
  const n = Number(process.env.X_INTAKE_DEDUPE_MAX_IDS || DEFAULT_MAX_IDS);
  return Number.isFinite(n) && n >= 100 ? Math.floor(n) : DEFAULT_MAX_IDS;
}

function ensureDedupeFile() {
  try {
    if (!fs.existsSync(dedupeFilePath)) {
      fs.writeFileSync(
        dedupeFilePath,
        JSON.stringify({ tweetIds: [], lastUpdatedAt: null }, null, 2),
        'utf8'
      );
    }
  } catch (err) {
    console.error('[XIntakeDedupe] ensure file failed:', err.message);
  }
}

function loadDedupeState() {
  try {
    ensureDedupeFile();
    const raw = fs.readFileSync(dedupeFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    const tweetIds = Array.isArray(parsed.tweetIds) ? parsed.tweetIds.map(String) : [];
    return { tweetIds, lastUpdatedAt: parsed.lastUpdatedAt || null };
  } catch (err) {
    console.error('[XIntakeDedupe] load failed:', err.message);
    return { tweetIds: [], lastUpdatedAt: null };
  }
}

function saveDedupeState(tweetIds) {
  try {
    const max = maxStoredIds();
    let list = tweetIds;
    if (list.length > max) {
      list = list.slice(list.length - max);
    }
    const payload = {
      tweetIds: list,
      lastUpdatedAt: new Date().toISOString()
    };
    fs.writeFileSync(dedupeFilePath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.error('[XIntakeDedupe] save failed:', err.message);
  }
}

function normalizeTweetDedupeId(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (s.length > 64) return s.slice(0, 64);
  return s;
}

/**
 * @param {string} tweetId — X API tweet id or your own stable event id
 * @returns {boolean}
 */
function isXIntakeTweetProcessed(tweetId) {
  const id = normalizeTweetDedupeId(tweetId);
  if (!id) return false;
  const { tweetIds } = loadDedupeState();
  return tweetIds.includes(id);
}

/**
 * Record a tweet/event id after a successful tracked apply (not dry-run).
 * @param {string} tweetId
 */
function markXIntakeTweetProcessed(tweetId) {
  const id = normalizeTweetDedupeId(tweetId);
  if (!id) return;

  const { tweetIds } = loadDedupeState();
  if (tweetIds.includes(id)) return;

  tweetIds.push(id);
  saveDedupeState(tweetIds);
}

module.exports = {
  dedupeFilePath,
  normalizeTweetDedupeId,
  isXIntakeTweetProcessed,
  markXIntakeTweetProcessed,
  maxStoredIds
};
