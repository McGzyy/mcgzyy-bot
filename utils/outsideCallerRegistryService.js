/**
 * Curated registry of outside X callers (non-community accounts).
 * Phase A: storage + services only (no ingestion, no stats, no automation).
 */

const fs = require('fs');
const path = require('path');
const { normalizeXHandle, isLikelyXHandle } = require('./userProfileService');

const filePath = path.join(__dirname, '../data/outsideCallers.json');

function ensureFile() {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf8');
    }
  } catch (e) {
    console.error('[OutsideCallers] ensure file failed:', e.message);
  }
}

function loadAllRaw() {
  try {
    ensureFile();
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    console.error('[OutsideCallers] load failed:', e.message);
    return [];
  }
}

function saveAllRaw(entries) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf8');
  } catch (e) {
    console.error('[OutsideCallers] save failed:', e.message);
  }
}

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s || fallback;
}

/** Canonical stored handle: lowercase, no @. */
function normalizeStoredXHandle(value) {
  const h = normalizeXHandle(value);
  return h ? h.toLowerCase() : '';
}

function normalizeTags(tags) {
  const arr = Array.isArray(tags) ? tags : [];
  const set = new Set();
  for (const t of arr) {
    const v = String(t || '').trim().toLowerCase();
    if (!v) continue;
    set.add(v);
  }
  return [...set].slice(0, 24);
}

function normalizeStatus(value) {
  const clean = String(value || '').trim().toLowerCase();
  return clean === 'inactive' ? 'inactive' : 'active';
}

function normalizeSourceContext(sourceContext, fallback = {}) {
  const base = sourceContext && typeof sourceContext === 'object' ? sourceContext : {};
  const type = String(base.sourceType || fallback.sourceType || 'internal').trim().toLowerCase();
  const allowed = ['user', 'mod', 'internal'];
  const sourceType = allowed.includes(type) ? type : 'internal';

  const out = { sourceType };
  const addedByUserId = normalizeString(base.addedByUserId ?? fallback.addedByUserId, '');
  if (addedByUserId) out.addedByUserId = addedByUserId;
  return out;
}

/**
 * Authoritative stored shape (timestamp-safe: does not mutate updatedAt on reads).
 */
function normalizeOutsideCallerEntry(input = {}) {
  const base = input && typeof input === 'object' ? input : {};
  const xHandle = normalizeStoredXHandle(base.xHandle);

  const metadataIn = base.metadata && typeof base.metadata === 'object' ? base.metadata : {};
  const createdAt = Number.isFinite(Number(metadataIn.createdAt)) ? Number(metadataIn.createdAt) : Date.now();
  const updatedAt = Number.isFinite(Number(metadataIn.updatedAt)) ? Number(metadataIn.updatedAt) : createdAt;

  const notes = normalizeString(base.notes, '');

  return {
    xHandle,
    displayName: normalizeString(base.displayName, ''),
    nickname: normalizeString(base.nickname, ''),
    notes,
    tags: normalizeTags(base.tags),
    status: normalizeStatus(base.status),

    // optional top-level convenience field
    addedByUserId: normalizeString(base.addedByUserId, ''),

    sourceContext: normalizeSourceContext(base.sourceContext, {
      ...(base.addedByUserId ? { addedByUserId: base.addedByUserId } : {})
    }),

    metadata: {
      createdAt,
      updatedAt
    }
  };
}

function validateEntry(entry) {
  const handle = String(entry?.xHandle || '').trim();
  if (!handle) return { ok: false, reason: 'missing_x_handle' };
  if (!isLikelyXHandle(handle)) return { ok: false, reason: 'bad_x_handle' };
  return { ok: true };
}

function getAllOutsideCallers() {
  return loadAllRaw().map(normalizeOutsideCallerEntry);
}

function listOutsideCallers(options = {}) {
  const includeInactive = options.includeInactive === true;
  const entries = getAllOutsideCallers();
  const filtered = includeInactive ? entries : entries.filter((e) => e.status !== 'inactive');
  return filtered.sort((a, b) => Number(b.metadata?.updatedAt || 0) - Number(a.metadata?.updatedAt || 0));
}

function getOutsideCallerByHandle(xHandle) {
  const h = normalizeStoredXHandle(xHandle);
  if (!h) return null;
  const entries = loadAllRaw();
  const found = entries.find((e) => normalizeStoredXHandle(e?.xHandle || '') === h);
  return found ? normalizeOutsideCallerEntry(found) : null;
}

function hasOutsideCaller(xHandle) {
  return !!getOutsideCallerByHandle(xHandle);
}

/**
 * @returns {{ ok: boolean, entry?: object, reason?: string }}
 */
function createOutsideCaller(input) {
  const now = Date.now();
  const entry = normalizeOutsideCallerEntry({
    ...(input && typeof input === 'object' ? input : {}),
    metadata: { createdAt: now, updatedAt: now }
  });

  const v = validateEntry(entry);
  if (!v.ok) return { ok: false, reason: v.reason };

  const entries = loadAllRaw();
  const exists = entries.some((e) => normalizeStoredXHandle(e?.xHandle || '') === entry.xHandle);
  if (exists) return { ok: false, reason: 'duplicate_x_handle' };

  entries.push(entry);
  saveAllRaw(entries);
  return { ok: true, entry };
}

/**
 * @returns {{ ok: boolean, entry?: object, reason?: string }}
 */
function updateOutsideCaller(xHandle, updates = {}) {
  const h = normalizeStoredXHandle(xHandle);
  if (!h) return { ok: false, reason: 'missing_x_handle' };

  const entries = loadAllRaw();
  const idx = entries.findIndex((e) => normalizeStoredXHandle(e?.xHandle || '') === h);
  if (idx === -1) return { ok: false, reason: 'not_found' };

  const existing = normalizeOutsideCallerEntry(entries[idx]);
  const patch = updates && typeof updates === 'object' ? updates : {};

  const merged = normalizeOutsideCallerEntry({
    ...existing,
    ...patch,
    xHandle: existing.xHandle, // immutable identity
    metadata: {
      createdAt: existing.metadata.createdAt,
      updatedAt: Date.now()
    }
  });

  const v = validateEntry(merged);
  if (!v.ok) return { ok: false, reason: v.reason };

  entries[idx] = merged;
  saveAllRaw(entries);
  return { ok: true, entry: merged };
}

/**
 * @returns {{ ok: boolean, reason?: string }}
 */
function deleteOutsideCaller(xHandle) {
  const h = normalizeStoredXHandle(xHandle);
  if (!h) return { ok: false, reason: 'missing_x_handle' };

  const entries = loadAllRaw();
  const before = entries.length;
  const filtered = entries.filter((e) => normalizeStoredXHandle(e?.xHandle || '') !== h);
  if (filtered.length === before) return { ok: false, reason: 'not_found' };

  saveAllRaw(filtered);
  return { ok: true };
}

module.exports = {
  ensureFile,
  loadAllRaw,
  saveAllRaw,

  normalizeOutsideCallerEntry,
  getAllOutsideCallers,
  listOutsideCallers,
  getOutsideCallerByHandle,
  hasOutsideCaller,
  createOutsideCaller,
  updateOutsideCaller,
  deleteOutsideCaller
};

