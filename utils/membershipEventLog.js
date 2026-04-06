const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../data/membershipEvents.jsonl');

function ensureFile() {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
    }
  } catch (err) {
    console.error('[MembershipEvents] ensure file failed:', err.message);
  }
}

function appendEvent(event) {
  try {
    ensureFile();
    fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf8');
    return true;
  } catch (err) {
    console.error('[MembershipEvents] append failed:', err.message);
    return false;
  }
}

function readAllText() {
  try {
    ensureFile();
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return '';
  }
}

function hasTxSignatureInMembershipEvents(txSignature) {
  const sig = String(txSignature || '').trim();
  if (!sig) return false;
  const raw = readAllText();
  return raw.includes(sig);
}

/**
 * Append-only membership audit log.
 * This is scaffolding only; nothing calls it automatically yet.
 */
function logMembershipEvent(type, {
  actorUserId = null,
  targetUserId = null,
  data = null
} = {}) {
  const event = {
    ts: new Date().toISOString(),
    type: String(type || '').trim() || 'membership_event',
    actorUserId: actorUserId != null ? String(actorUserId) : null,
    targetUserId: targetUserId != null ? String(targetUserId) : null,
    data: data != null ? data : null
  };
  return appendEvent(event);
}

module.exports = {
  filePath,
  hasTxSignatureInMembershipEvents,
  logMembershipEvent
};

