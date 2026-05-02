let queue = [];
let isProcessing = false;
let lastSendAt = 0;

// dedupe / cooldown / recent send state
const recentAlertKeys = new Map();
const recentContractActivity = new Map();
const recentSentByContract = new Map();

const ALERT_QUEUE_CONFIG = {
  minGapMs: 5000,            // minimum 5 sec between ANY alerts
  maxDelayMs: 30000,         // force-send if queued this long
  duplicateKeyMs: 60000,     // exact same alert blocked for 60 sec
  sameCoinCooldownMs: 15000, // same coin can't alert again for 15 sec
  suppressionWindowMs: 45000 // look back 45 sec for suppression rules
};

const ALERT_PRIORITY = {
  auto_call: 1,
  milestone: 2,
  dump: 3,
  unknown: 99
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function now() {
  return Date.now();
}

function cleanupOldState() {
  const current = now();

  for (const [key, ts] of recentAlertKeys.entries()) {
    if (current - ts > ALERT_QUEUE_CONFIG.duplicateKeyMs) {
      recentAlertKeys.delete(key);
    }
  }

  for (const [contract, ts] of recentContractActivity.entries()) {
    if (current - ts > ALERT_QUEUE_CONFIG.sameCoinCooldownMs) {
      recentContractActivity.delete(contract);
    }
  }

  for (const [contract, events] of recentSentByContract.entries()) {
    const filtered = events.filter(
      evt => current - evt.timestamp <= ALERT_QUEUE_CONFIG.suppressionWindowMs
    );

    if (filtered.length > 0) {
      recentSentByContract.set(contract, filtered);
    } else {
      recentSentByContract.delete(contract);
    }
  }
}

function buildAlertKey(meta = {}) {
  const type = meta.type || 'unknown';
  const contract = meta.contractAddress || 'no_ca';
  const key = meta.key || 'no_key';

  return `${type}:${contract}:${key}`;
}

function getPriority(meta = {}) {
  return ALERT_PRIORITY[meta.type] || ALERT_PRIORITY.unknown;
}

function getRecentEvents(contractAddress) {
  cleanupOldState();
  return recentSentByContract.get(contractAddress) || [];
}

/**
 * =========================
 * SMART SUPPRESSION
 * =========================
 */
function shouldSuppressAlert(meta = {}) {
  const contract = meta.contractAddress;
  if (!contract) return null;

  const recentEvents = getRecentEvents(contract);
  if (!recentEvents.length) return null;

  const hadRecentAutoCall = recentEvents.some(evt => evt.type === 'auto_call');

  // suppress weak follow-up milestone
  if (meta.type === 'milestone' && meta.key === '2x' && hadRecentAutoCall) {
    return 'suppressed_after_recent_auto_call';
  }

  // suppress weak follow-up dump
  if (meta.type === 'dump' && meta.key === '-35%' && hadRecentAutoCall) {
    return 'suppressed_after_recent_auto_call';
  }

  return null;
}

function shouldRejectAlert(meta = {}) {
  cleanupOldState();

  const current = now();
  const alertKey = buildAlertKey(meta);
  const contract = meta.contractAddress;

  // 0) smart suppression
  const suppressionReason = shouldSuppressAlert(meta);
  if (suppressionReason) {
    return suppressionReason;
  }

  // 1) exact duplicate protection
  const lastSameAlert = recentAlertKeys.get(alertKey);
  if (lastSameAlert && (current - lastSameAlert) < ALERT_QUEUE_CONFIG.duplicateKeyMs) {
    return 'duplicate_exact';
  }

  // 2) same coin cooldown (only if contract exists)
  if (contract) {
    const lastCoinActivity = recentContractActivity.get(contract);
    if (lastCoinActivity && (current - lastCoinActivity) < ALERT_QUEUE_CONFIG.sameCoinCooldownMs) {
      return 'same_coin_cooldown';
    }
  }

  return null;
}

function markAlert(meta = {}) {
  const current = now();
  const alertKey = buildAlertKey(meta);
  const contract = meta.contractAddress;

  recentAlertKeys.set(alertKey, current);

  if (contract) {
    recentContractActivity.set(contract, current);
  }
}

function markSent(meta = {}) {
  const contract = meta.contractAddress;
  if (!contract) return;

  const events = recentSentByContract.get(contract) || [];

  events.push({
    type: meta.type || 'unknown',
    key: meta.key || null,
    timestamp: now()
  });

  recentSentByContract.set(contract, events);
}

function sortQueue() {
  queue.sort((a, b) => {
    const aAge = now() - a.createdAt;
    const bAge = now() - b.createdAt;

    const aForced = aAge >= ALERT_QUEUE_CONFIG.maxDelayMs;
    const bForced = bAge >= ALERT_QUEUE_CONFIG.maxDelayMs;

    // 1) force-send overdue alerts first
    if (aForced && !bForced) return -1;
    if (!aForced && bForced) return 1;

    // 2) then sort by priority
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }

    // 3) then oldest first
    return a.createdAt - b.createdAt;
  });
}

function enqueueAlert(sendFn, meta = {}) {
  const rejectReason = shouldRejectAlert(meta);

  if (rejectReason) {
    console.log(
      `[AlertQueue] Skipped ${meta.type || 'alert'} for ${meta.contractAddress || 'unknown'} (${rejectReason})`
    );
    return false;
  }

  queue.push({
    sendFn,
    createdAt: now(),
    meta,
    priority: getPriority(meta)
  });

  // mark immediately so duplicates don't even enter queue
  markAlert(meta);

  sortQueue();

  processQueue().catch(err => {
    console.error('[AlertQueue] Processing error:', err.message);
  });

  return true;
}

async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    while (queue.length > 0) {
      sortQueue();

      const next = queue[0];
      const age = now() - next.createdAt;
      const sinceLastSend = now() - lastSendAt;

      const mustForceSend = age >= ALERT_QUEUE_CONFIG.maxDelayMs;
      const needsWait = sinceLastSend < ALERT_QUEUE_CONFIG.minGapMs;

      if (needsWait && !mustForceSend) {
        const waitMs = ALERT_QUEUE_CONFIG.minGapMs - sinceLastSend;
        await sleep(waitMs);
      }

      sortQueue();
      const item = queue.shift();

      try {
        await item.sendFn();
        lastSendAt = now();
        markSent(item.meta);

        console.log(
          `[AlertQueue] Sent ${item.meta.type || 'alert'} for ${item.meta.contractAddress || 'unknown'}`
        );
      } catch (err) {
        const meta = item.meta || {};
        console.error(
          '[AlertQueue] Failed to send alert:',
          meta.type || 'alert',
          meta.contractAddress || '',
          err && err.message ? err.message : err,
          err && err.stack ? '\n' + err.stack : ''
        );
      }
    }
  } finally {
    isProcessing = false;
  }
}

module.exports = {
  enqueueAlert
};