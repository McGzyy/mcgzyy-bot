'use strict';

const crypto = require('crypto');
const path = require('path');
const { readJson, writeJson } = require('./jsonStore');

const PENDING_PATH = path.join(__dirname, '../data/pendingDevSubmissions.json');

/** @type {Map<string, object> | null} */
let cache = null;
let hydrated = false;

async function hydrate() {
  if (hydrated) return;
  hydrated = true;
  cache = new Map();
  try {
    const data = await readJson(PENDING_PATH);
    const list = Array.isArray(data?.submissions) ? data.submissions : [];
    for (const s of list) {
      if (s && typeof s === 'object' && s.id) {
        cache.set(String(s.id), s);
      }
    }
  } catch (e) {
    const code = e && /** @type {{ code?: string }} */ (e).code;
    if (code !== 'ENOENT') {
      console.error('[DevSubmission] Failed to load pending submissions:', e.message || e);
    }
  }
}

function persist() {
  if (!cache) return;
  const submissions = [...cache.values()];
  writeJson(PENDING_PATH, { submissions }).catch(err => {
    console.error('[DevSubmission] Persist failed:', err.message || err);
  });
}

/**
 * @param {string} text
 * @param {(addr: string) => boolean} isValid
 * @returns {string[]}
 */
function parseCommaSeparatedAddresses(text, isValid) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const seen = new Set();
  const out = [];
  for (const part of raw.split(/[,;\n]+/)) {
    const a = part.trim();
    if (!a || seen.has(a)) continue;
    if (!isValid(a)) continue;
    seen.add(a);
    out.push(a);
  }
  return out;
}

/**
 * @param {object} payload
 * @returns {Promise<{ id: string } & object>}
 */
async function createPendingDevSubmission(payload) {
  await hydrate();
  const id = crypto.randomBytes(12).toString('hex');
  const row = {
    id,
    createdAt: new Date().toISOString(),
    ...payload
  };
  cache.set(id, row);
  persist();
  return row;
}

/**
 * @param {string} id
 * @returns {Promise<object | null>}
 */
async function takePendingDevSubmission(id) {
  await hydrate();
  const key = String(id || '');
  const row = cache.get(key);
  if (!row) return null;
  cache.delete(key);
  persist();
  return row;
}

/**
 * @param {string} id
 * @returns {Promise<object | null>}
 */
async function peekPendingDevSubmission(id) {
  await hydrate();
  return cache.get(String(id || '')) || null;
}

/**
 * Restore a row (e.g. after failed apply). Same id must be used.
 * @param {object} row
 */
async function returnPendingDevSubmission(row) {
  await hydrate();
  if (!row || !row.id) return;
  cache.set(String(row.id), row);
  persist();
}

/**
 * Patch a pending submission (e.g. mod edits). Returns updated row or null.
 * @param {string} id
 * @param {object} updates
 */
async function updatePendingDevSubmission(id, updates) {
  await hydrate();
  const key = String(id || '');
  const row = cache.get(key);
  if (!row) return null;
  Object.assign(row, updates, { updatedAt: new Date().toISOString() });
  cache.set(key, row);
  persist();
  return row;
}

module.exports = {
  createPendingDevSubmission,
  takePendingDevSubmission,
  peekPendingDevSubmission,
  returnPendingDevSubmission,
  updatePendingDevSubmission,
  parseCommaSeparatedAddresses,
  PENDING_PATH
};
