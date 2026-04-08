const fs = require('fs');
const path = require('path');
const { isLikelySolanaCA } = require('./solanaAddress');

const filePath = path.join(__dirname, '../data/lowCapRegistry.json');

function ensureFile() {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf8');
    }
  } catch (e) {
    console.error('[LowCapRegistry] ensure file failed:', e.message);
  }
}

function loadAllRaw() {
  try {
    ensureFile();
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    console.error('[LowCapRegistry] load failed:', e.message);
    return [];
  }
}

function saveAllRaw(entries) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf8');
  } catch (e) {
    console.error('[LowCapRegistry] save failed:', e.message);
  }
}

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s || fallback;
}

function normalizeRequiredString(value) {
  const s = normalizeString(value, '');
  return s;
}

function normalizeTicker(value) {
  const s = normalizeString(value, '');
  return s ? s.toUpperCase() : '';
}

function normalizeNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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

function normalizeLifecycle(value) {
  const clean = String(value || '').trim().toLowerCase();
  const allowed = ['watching', 'accumulating', 'sent', 'dead'];
  if (allowed.includes(clean)) return clean;
  return 'watching';
}

function normalizeDevLink(devLink) {
  if (!devLink || typeof devLink !== 'object') return null;
  const walletAddress = normalizeString(devLink.walletAddress, '');
  const xHandle = normalizeString(devLink.xHandle, '').replace(/^@+/, '');
  const linkedWalletAddress = normalizeString(devLink.linkedWalletAddress, '');

  const out = {};
  if (walletAddress) out.walletAddress = walletAddress;
  if (xHandle) out.xHandle = xHandle;
  if (linkedWalletAddress) out.linkedWalletAddress = linkedWalletAddress;

  return Object.keys(out).length ? out : null;
}

function normalizeSourceContext(sourceContext, fallback = {}) {
  const base = sourceContext && typeof sourceContext === 'object' ? sourceContext : {};
  const submissionType = String(base.submissionType || fallback.submissionType || 'internal')
    .trim()
    .toLowerCase();
  const allowed = ['user', 'mod', 'internal'];
  const type = allowed.includes(submissionType) ? submissionType : 'internal';

  const submittedByUserId = normalizeString(base.submittedByUserId ?? fallback.submittedByUserId, '');
  const approvedByUserId = normalizeString(base.approvedByUserId ?? fallback.approvedByUserId, '');

  const out = { submissionType: type };
  if (submittedByUserId) out.submittedByUserId = submittedByUserId;
  if (approvedByUserId) out.approvedByUserId = approvedByUserId;
  return out;
}

/**
 * Normalize an approved registry entry to the authoritative shape.
 * Does not validate existence or enforce uniqueness.
 */
function normalizeLowCapEntry(input = {}) {
  const base = input && typeof input === 'object' ? input : {};

  const contractAddress = normalizeRequiredString(base.contractAddress);

  const metadataIn = base.metadata && typeof base.metadata === 'object' ? base.metadata : {};
  const createdAt = Number.isFinite(Number(metadataIn.createdAt)) ? Number(metadataIn.createdAt) : Date.now();
  const updatedAt = Number.isFinite(Number(metadataIn.updatedAt))
    ? Number(metadataIn.updatedAt)
    : createdAt;

  const narrative = normalizeRequiredString(base.narrative);
  const notes = normalizeRequiredString(base.notes);

  return {
    contractAddress,
    name: normalizeString(base.name, ''),
    ticker: normalizeTicker(base.ticker),

    narrative,
    notes,

    currentMarketCap: normalizeNumberOrNull(base.currentMarketCap),
    previousAthMarketCap: normalizeNumberOrNull(base.previousAthMarketCap),

    tags: normalizeTags(base.tags),

    lifecycle: normalizeLifecycle(base.lifecycle),

    devLink: normalizeDevLink(base.devLink),

    sourceContext: normalizeSourceContext(base.sourceContext, {}),

    metadata: {
      createdAt,
      updatedAt
    }
  };
}

function validateEntry(entry) {
  const ca = String(entry?.contractAddress || '').trim();
  if (!ca || !isLikelySolanaCA(ca)) return { ok: false, reason: 'bad_contract_address' };
  const narrative = String(entry?.narrative || '').trim();
  if (!narrative) return { ok: false, reason: 'missing_narrative' };
  const notes = String(entry?.notes || '').trim();
  if (!notes) return { ok: false, reason: 'missing_notes' };
  return { ok: true };
}

function getAllLowCapEntries() {
  return loadAllRaw().map(normalizeLowCapEntry);
}

function listLowCapEntries(options = {}) {
  const includeDead = options.includeDead === true;
  const entries = getAllLowCapEntries();
  const filtered = includeDead ? entries : entries.filter((e) => e.lifecycle !== 'dead');
  return filtered.sort((a, b) => Number(b.metadata?.updatedAt || 0) - Number(a.metadata?.updatedAt || 0));
}

function getLowCapEntryByContractAddress(contractAddress) {
  const ca = normalizeRequiredString(contractAddress);
  if (!ca) return null;
  const entries = loadAllRaw();
  const found = entries.find((e) => String(e?.contractAddress || '').trim() === ca);
  return found ? normalizeLowCapEntry(found) : null;
}

function hasLowCapEntry(contractAddress) {
  return !!getLowCapEntryByContractAddress(contractAddress);
}

function createLowCapEntry(input) {
  const now = Date.now();
  const entry = normalizeLowCapEntry({
    ...(input && typeof input === 'object' ? input : {}),
    metadata: { createdAt: now, updatedAt: now }
  });
  const v = validateEntry(entry);
  if (!v.ok) {
    return { ok: false, reason: v.reason };
  }

  const entries = loadAllRaw();
  const exists = entries.some((e) => String(e?.contractAddress || '').trim() === entry.contractAddress);
  if (exists) {
    return { ok: false, reason: 'duplicate_contract_address' };
  }

  if (!entry.lifecycle) entry.lifecycle = 'watching';

  entries.push(entry);
  saveAllRaw(entries);
  return { ok: true, entry };
}

function updateLowCapEntry(contractAddress, updates = {}) {
  const ca = normalizeRequiredString(contractAddress);
  if (!ca) return { ok: false, reason: 'missing_contract_address' };

  const entries = loadAllRaw();
  const idx = entries.findIndex((e) => String(e?.contractAddress || '').trim() === ca);
  if (idx === -1) return { ok: false, reason: 'not_found' };

  const existing = normalizeLowCapEntry(entries[idx]);
  const patch = updates && typeof updates === 'object' ? updates : {};

  const mergedSourceContext = normalizeSourceContext(
    { ...existing.sourceContext, ...(patch.sourceContext || {}) },
    existing.sourceContext
  );

  const merged = normalizeLowCapEntry({
    ...existing,
    ...patch,
    contractAddress: existing.contractAddress,
    sourceContext: mergedSourceContext,
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

function deleteLowCapEntry(contractAddress) {
  const ca = normalizeRequiredString(contractAddress);
  if (!ca) return { ok: false, reason: 'missing_contract_address' };
  const entries = loadAllRaw();
  const before = entries.length;
  const filtered = entries.filter((e) => String(e?.contractAddress || '').trim() !== ca);
  if (filtered.length === before) return { ok: false, reason: 'not_found' };
  saveAllRaw(filtered);
  return { ok: true };
}

module.exports = {
  ensureFile,
  loadAllRaw,
  saveAllRaw,

  normalizeLowCapEntry,
  getAllLowCapEntries,
  listLowCapEntries,
  getLowCapEntryByContractAddress,
  hasLowCapEntry,
  createLowCapEntry,
  updateLowCapEntry,
  deleteLowCapEntry
};

