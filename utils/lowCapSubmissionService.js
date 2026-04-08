/**
 * Pending submissions for curated low-cap registry.
 * Does not modify tracked calls or other systems.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isLikelySolanaCA } = require('./solanaAddress');
const { hasLowCapEntry, createLowCapEntry } = require('./lowCapRegistryService');

const filePath = path.join(__dirname, '../data/lowCapSubmissions.json');

function ensureFile() {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify({ submissions: [] }, null, 2), 'utf8');
    }
  } catch (e) {
    console.error('[LowCapSubmit] ensure file failed:', e.message);
  }
}

function loadAll() {
  try {
    ensureFile();
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const list = Array.isArray(raw?.submissions) ? raw.submissions : [];
    return { submissions: list };
  } catch (e) {
    console.error('[LowCapSubmit] load failed:', e.message);
    return { submissions: [] };
  }
}

function saveAll(data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[LowCapSubmit] save failed:', e.message);
  }
}

function newId() {
  return `lcs_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function normalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s || fallback;
}

function normalizeTicker(value) {
  const s = normalizeString(value, '');
  return s ? s.toUpperCase() : null;
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

function normalizeReview(review) {
  const base = review && typeof review === 'object' ? review : {};
  const out = {};
  if (base.reviewMessageId != null) out.reviewMessageId = normalizeString(base.reviewMessageId, '');
  if (base.reviewChannelId != null) out.reviewChannelId = normalizeString(base.reviewChannelId, '');
  if (base.reviewedByUserId != null) out.reviewedByUserId = normalizeString(base.reviewedByUserId, '');

  const reviewedAt = normalizeNumberOrNull(base.reviewedAt);
  if (reviewedAt !== null) out.reviewedAt = reviewedAt;

  const denialReason = normalizeString(base.denialReason, '');
  if (denialReason) out.denialReason = denialReason;

  return out;
}

function normalizeLowCapSubmission(input = {}) {
  const base = input && typeof input === 'object' ? input : {};

  const metadataIn = base.metadata && typeof base.metadata === 'object' ? base.metadata : {};
  const createdAt = Number.isFinite(Number(metadataIn.createdAt)) ? Number(metadataIn.createdAt) : Date.now();
  const updatedAt = Number.isFinite(Number(metadataIn.updatedAt))
    ? Number(metadataIn.updatedAt)
    : createdAt;

  const status = String(base.status || 'pending').trim().toLowerCase();
  const allowedStatus = ['pending', 'approved', 'denied'];
  const safeStatus = allowedStatus.includes(status) ? status : 'pending';

  return {
    submissionId: normalizeString(base.submissionId, '') || newId(),
    status: safeStatus,

    contractAddress: normalizeString(base.contractAddress, ''),
    name: normalizeString(base.name, '') || null,
    ticker: normalizeTicker(base.ticker),

    narrative: normalizeString(base.narrative, ''),
    notes: normalizeString(base.notes, ''),

    currentMarketCap: normalizeNumberOrNull(base.currentMarketCap),
    previousAthMarketCap: normalizeNumberOrNull(base.previousAthMarketCap),

    tags: normalizeTags(base.tags),

    submittedByUserId: normalizeString(base.submittedByUserId, ''),
    submittedByUsername: normalizeString(base.submittedByUsername, '').slice(0, 80),

    review: normalizeReview(base.review),

    metadata: {
      createdAt,
      updatedAt
    }
  };
}

function validateSubmission(sub) {
  const ca = String(sub?.contractAddress || '').trim();
  if (!ca || !isLikelySolanaCA(ca)) return { ok: false, reason: 'bad_contract_address' };
  const narrative = String(sub?.narrative || '').trim();
  if (!narrative) return { ok: false, reason: 'missing_narrative' };
  const notes = String(sub?.notes || '').trim();
  if (!notes) return { ok: false, reason: 'missing_notes' };
  const uid = String(sub?.submittedByUserId || '').trim();
  if (!uid) return { ok: false, reason: 'missing_submitted_by_user_id' };
  return { ok: true };
}

function getAllLowCapSubmissions() {
  return loadAll().submissions.map(normalizeLowCapSubmission);
}

function getLowCapSubmissionById(submissionId) {
  const id = normalizeString(submissionId, '');
  if (!id) return null;
  const data = loadAll();
  const found = data.submissions.find((s) => String(s?.submissionId || s?.id || '') === id);
  return found ? normalizeLowCapSubmission(found) : null;
}

function getPendingLowCapSubmissions() {
  return getAllLowCapSubmissions().filter((s) => s.status === 'pending');
}

function updateLowCapSubmissionReviewMessage(submissionId, reviewMessageData = {}) {
  const data = loadAll();
  const id = normalizeString(submissionId, '');
  const idx = data.submissions.findIndex((s) => String(s?.submissionId || s?.id || '') === id);
  if (idx === -1) return null;

  const existing = normalizeLowCapSubmission(data.submissions[idx]);
  const nextReview = normalizeReview({ ...existing.review, ...(reviewMessageData || {}) });
  const updated = normalizeLowCapSubmission({
    ...existing,
    review: nextReview,
    metadata: {
      createdAt: existing.metadata.createdAt,
      updatedAt: Date.now()
    }
  });

  data.submissions[idx] = updated;
  saveAll(data);
  return updated;
}

/**
 * @returns {{ ok: boolean, submission?: object, reason?: string }}
 */
function createLowCapSubmission(input) {
  const now = Date.now();
  const draft = normalizeLowCapSubmission({
    ...input,
    status: 'pending',
    review: {},
    metadata: { createdAt: now, updatedAt: now }
  });

  const v = validateSubmission(draft);
  if (!v.ok) return { ok: false, reason: v.reason };

  if (hasLowCapEntry(draft.contractAddress)) {
    return { ok: false, reason: 'already_in_registry' };
  }

  const data = loadAll();
  const caLower = draft.contractAddress.toLowerCase();
  const pendingSameCa = data.submissions.some(
    (s) =>
      String(s?.status || '').toLowerCase() === 'pending' &&
      String(s?.contractAddress || '').toLowerCase() === caLower
  );
  if (pendingSameCa) {
    return { ok: false, reason: 'duplicate_pending_ca' };
  }

  data.submissions.push(draft);
  saveAll(data);
  return { ok: true, submission: draft };
}

/**
 * Approve a submission.
 * By default, also creates the authoritative registry entry (matches curated registry patterns).
 *
 * @returns {{ ok: boolean, submission?: object, entry?: object, reason?: string }}
 */
function approveLowCapSubmission(submissionId, reviewData = {}) {
  const data = loadAll();
  const id = normalizeString(submissionId, '');
  const idx = data.submissions.findIndex((s) => String(s?.submissionId || s?.id || '') === id);
  if (idx === -1) return { ok: false, reason: 'not_found' };

  const existing = normalizeLowCapSubmission(data.submissions[idx]);
  if (existing.status !== 'pending') return { ok: false, reason: 'already_resolved' };

  if (hasLowCapEntry(existing.contractAddress)) {
    // transition-safe: someone may have added it manually
    const updatedExisting = normalizeLowCapSubmission({
      ...existing,
      status: 'approved',
      review: normalizeReview({
        ...existing.review,
        ...reviewData,
        reviewedAt: reviewData.reviewedAt ?? Date.now()
      }),
      metadata: { createdAt: existing.metadata.createdAt, updatedAt: Date.now() }
    });
    data.submissions[idx] = updatedExisting;
    saveAll(data);
    return { ok: true, submission: updatedExisting, reason: 'already_in_registry' };
  }

  const reviewedAt = reviewData.reviewedAt ?? Date.now();
  const reviewedByUserId = normalizeString(reviewData.reviewedByUserId, '');

  // Create authoritative entry first (transaction-like approval).
  const entryCreate = createLowCapEntry({
    contractAddress: existing.contractAddress,
    name: existing.name || '',
    ticker: existing.ticker || '',
    narrative: existing.narrative,
    notes: existing.notes,
    currentMarketCap: existing.currentMarketCap,
    previousAthMarketCap: existing.previousAthMarketCap,
    tags: existing.tags,
    lifecycle: 'watching',
    devLink: null,
    sourceContext: {
      submissionType: 'user',
      submittedByUserId: existing.submittedByUserId,
      ...(reviewedByUserId ? { approvedByUserId: reviewedByUserId } : {})
    }
  });

  if (!entryCreate.ok) {
    // Do NOT mark approved; keep pending and do not write changes.
    return { ok: false, reason: `registry_create_failed:${entryCreate.reason}` };
  }

  const updated = normalizeLowCapSubmission({
    ...existing,
    status: 'approved',
    review: normalizeReview({
      ...existing.review,
      ...reviewData,
      ...(reviewedByUserId ? { reviewedByUserId } : {}),
      reviewedAt
    }),
    metadata: { createdAt: existing.metadata.createdAt, updatedAt: Date.now() }
  });

  data.submissions[idx] = updated;
  saveAll(data);
  return { ok: true, submission: updated, entry: entryCreate.entry };
}

function denyLowCapSubmission(submissionId, reviewData = {}) {
  const data = loadAll();
  const id = normalizeString(submissionId, '');
  const idx = data.submissions.findIndex((s) => String(s?.submissionId || s?.id || '') === id);
  if (idx === -1) return { ok: false, reason: 'not_found' };

  const existing = normalizeLowCapSubmission(data.submissions[idx]);
  if (existing.status !== 'pending') return { ok: false, reason: 'already_resolved' };

  const reviewedAt = reviewData.reviewedAt ?? Date.now();
  const reviewedByUserId = normalizeString(reviewData.reviewedByUserId, '');
  const denialReason = normalizeString(reviewData.denialReason, '');

  const updated = normalizeLowCapSubmission({
    ...existing,
    status: 'denied',
    review: normalizeReview({
      ...existing.review,
      ...reviewData,
      ...(reviewedByUserId ? { reviewedByUserId } : {}),
      reviewedAt,
      ...(denialReason ? { denialReason } : {})
    }),
    metadata: { createdAt: existing.metadata.createdAt, updatedAt: Date.now() }
  });

  data.submissions[idx] = updated;
  saveAll(data);
  return { ok: true, submission: updated };
}

module.exports = {
  ensureFile,
  loadAll,
  saveAll,

  normalizeLowCapSubmission,
  getAllLowCapSubmissions,
  getLowCapSubmissionById,
  getPendingLowCapSubmissions,
  createLowCapSubmission,
  approveLowCapSubmission,
  denyLowCapSubmission,
  updateLowCapSubmissionReviewMessage
};

