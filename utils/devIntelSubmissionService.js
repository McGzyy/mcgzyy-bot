/**
 * Pending user submissions for dev↔coin intel (curated registry).
 * Does not write to tracked devs until mod approval.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeStoredDevXHandle, isLikelySolWallet } = require('./devRegistryService');

const filePath = path.join(__dirname, '../data/devIntelSubmissions.json');

function ensureFile() {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
      filePath,
      JSON.stringify({ submissions: [] }, null, 2),
      'utf8'
    );
  }
}

function loadAll() {
  try {
    ensureFile();
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const list = Array.isArray(raw?.submissions) ? raw.submissions : [];
    return { submissions: list };
  } catch (e) {
    console.error('[DevIntelSubmit] load failed:', e.message);
    return { submissions: [] };
  }
}

function saveAll(data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[DevIntelSubmit] save failed:', e.message);
  }
}

function newId() {
  return `dis_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function parseTagsCsv(s) {
  return String(s || '')
    .split(/[,;]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);
}

/**
 * @returns {{ ok: boolean, submission?: object, reason?: string }}
 */
function createSubmission({
  submittedByUserId,
  submittedByUsername,
  devWallet = '',
  devXHandle = '',
  contractAddress = '',
  note = '',
  tagsSuggested = []
}) {
  const ca = String(contractAddress || '').trim();
  if (!ca) {
    return { ok: false, reason: 'missing_ca' };
  }

  let w = String(devWallet || '').trim();
  const x = normalizeStoredDevXHandle(devXHandle);
  if (w && !isLikelySolWallet(w)) {
    return { ok: false, reason: 'bad_wallet' };
  }
  if (!w && !x) {
    return { ok: false, reason: 'need_wallet_or_x' };
  }

  const data = loadAll();
  const uid = String(submittedByUserId || '');
  const pendingSame = data.submissions.some(
    (s) =>
      s.status === 'pending' &&
      String(s.submittedByUserId) === uid &&
      String(s.contractAddress || '').toLowerCase() === ca.toLowerCase()
  );
  if (pendingSame) {
    return { ok: false, reason: 'duplicate_pending' };
  }

  const submission = {
    id: newId(),
    status: 'pending',
    submittedAt: new Date().toISOString(),
    submittedByUserId: uid,
    submittedByUsername: String(submittedByUsername || '').slice(0, 80),
    devWallet: w,
    devXHandle: x,
    contractAddress: ca,
    note: String(note || '').slice(0, 500),
    tagsSuggested: Array.isArray(tagsSuggested) ? tagsSuggested.slice(0, 12) : [],
    reviewMessageId: null,
    reviewChannelId: null,
    resolvedAt: null,
    moderatorUserId: null,
    decisionReason: null
  };

  data.submissions.push(submission);
  saveAll(data);
  return { ok: true, submission };
}

function getSubmission(id) {
  const data = loadAll();
  return data.submissions.find((s) => s.id === id) || null;
}

function updateSubmission(id, patch) {
  const data = loadAll();
  const i = data.submissions.findIndex((s) => s.id === id);
  if (i === -1) return null;
  data.submissions[i] = { ...data.submissions[i], ...patch };
  saveAll(data);
  return data.submissions[i];
}

function getPendingSubmissions() {
  return loadAll().submissions.filter((s) => s.status === 'pending');
}

function getSubmissionsNeedingModMessage() {
  return getPendingSubmissions().filter((s) => !s.reviewMessageId);
}

function getResolvedSubmissionsForChannelCleanup(modChannelId, minAgeMs) {
  const now = Date.now();
  return loadAll().submissions.filter((s) => {
    if (s.status === 'pending') return false;
    if (!s.resolvedAt || !s.reviewMessageId || !s.reviewChannelId) return false;
    if (String(s.reviewChannelId) !== String(modChannelId)) return false;
    const t = new Date(s.resolvedAt).getTime();
    if (!Number.isFinite(t)) return false;
    return now - t >= minAgeMs;
  });
}

module.exports = {
  loadAll,
  createSubmission,
  getSubmission,
  updateSubmission,
  getPendingSubmissions,
  getSubmissionsNeedingModMessage,
  getResolvedSubmissionsForChannelCleanup,
  parseTagsCsv
};
