const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../data/referralEvents.jsonl');

function ensureFile() {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
    }
  } catch (err) {
    console.error('[ReferralEvents] ensure file failed:', err.message);
  }
}

function appendEvent(event) {
  try {
    ensureFile();
    fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf8');
    return true;
  } catch (err) {
    console.error('[ReferralEvents] append failed:', err.message);
    return false;
  }
}

/**
 * Append-only referral audit log.
 * This is scaffolding only; nothing calls it automatically yet.
 */
function logReferralEvent(type, {
  actorUserId = null,
  targetUserId = null,
  data = null
} = {}) {
  const event = {
    ts: new Date().toISOString(),
    type: String(type || '').trim() || 'referral_event',
    actorUserId: actorUserId != null ? String(actorUserId) : null,
    targetUserId: targetUserId != null ? String(targetUserId) : null,
    data: data != null ? data : null
  };
  return appendEvent(event);
}

module.exports = {
  filePath,
  logReferralEvent
};

