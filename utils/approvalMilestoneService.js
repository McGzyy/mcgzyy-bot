const { loadScannerSettings } = require('./scannerSettingsService');

/**
 * X + mod approval pipeline (scanner ON, scanner OFF / FaSol mirror, and manual ingest):
 *
 * 1) `approvalTriggerX` (scanner settings / `data/scannerSettings.json`)
 *    Minimum ATH× (vs first-called MC) before **#mod-approvals** can be opened for a coin.
 *
 * 2) `approvalMilestoneLadder` (same settings file)
 *    Sorted rungs ≥ trigger. Used for **both**:
 *    - Which rung the next Discord approval card is for (`shouldCreateApprovalRequest` → highest
 *      eligible rung not yet recorded in `approvalMilestonesTriggered`).
 *    - Which ATH× rung to post on **X** after mod approve (`resolveNextBroadcastMilestone` in
 *      `xMilestonePublish.js` — standalone posts at broadcast rungs; quote-tweet prior milestone).
 *
 * FaSol / performance mirror uses the same functions once MC is refreshed — same two settings,
 * same behavior as the full scanner for mod + X (Discord embed milestones are separate; see
 * `DISCORD_MILESTONE_LEVELS` in `monitoringEngine.js`).
 */

const PRESET_APPROVAL_LADDER = [2, 3, 5, 8, 12, 20, 30, 50, 74, 100];

function normalizeLadderRungs(list) {
  return [...new Set(
    list
      .map(n => Number(n))
      .filter(n => Number.isFinite(n) && n >= 1)
  )].sort((a, b) => a - b);
}

function getApprovalTriggerX() {
  const settings = loadScannerSettings() || {};
  return Number(settings.approvalTriggerX || 8);
}

/**
 * ATH multiple from first called MC (same field resolution as legacy index.js getCurrentX).
 */
function computeApprovalAthX(trackedCall) {
  if (!trackedCall) return 0;

  const ath = Number(
    trackedCall.ath ||
    trackedCall.athMc ||
    trackedCall.athMarketCap ||
    trackedCall.latestMarketCap ||
    trackedCall.firstCalledMarketCap ||
    0
  );

  const firstCalledMc = Number(trackedCall.firstCalledMarketCap || 0);
  if (firstCalledMc <= 0) return 0;

  return ath / firstCalledMc;
}

function getApprovalMilestoneLadder() {
  const settings = loadScannerSettings() || {};
  const trigger = getApprovalTriggerX();

  let baseLadder;
  if (Array.isArray(settings.approvalMilestoneLadder) && settings.approvalMilestoneLadder.length) {
    baseLadder = normalizeLadderRungs(settings.approvalMilestoneLadder);
  } else {
    baseLadder = [...PRESET_APPROVAL_LADDER];
  }

  const filtered = baseLadder.filter(x => x >= trigger);
  const rungs = filtered.length ? filtered : [trigger];
  // Ensure approvalTriggerX is always an actual ladder rung (preset may skip it, e.g. trigger 4 vs first preset rung 5).
  return normalizeLadderRungs([...rungs, trigger]);
}

function getHighestEligibleApprovalMilestone(currentX) {
  const ladder = getApprovalMilestoneLadder();
  const eligible = ladder.filter(x => currentX >= x);
  if (!eligible.length) return 0;
  return Math.max(...eligible);
}

/**
 * @param {object} trackedCall
 * @param {number} [currentX] — if omitted, uses computeApprovalAthX(trackedCall)
 */
function shouldCreateApprovalRequest(trackedCall, currentX = null) {
  if (!trackedCall) return { shouldSend: false, triggerX: 0 };

  const approvalStatus = String(trackedCall.approvalStatus || '').toLowerCase();
  if (approvalStatus === 'approved' || approvalStatus === 'denied') {
    return { shouldSend: false, triggerX: 0 };
  }

  const x =
    currentX != null && Number.isFinite(Number(currentX))
      ? Number(currentX)
      : computeApprovalAthX(trackedCall);

  const approvalTriggerX = getApprovalTriggerX();
  if (x < approvalTriggerX) {
    return { shouldSend: false, triggerX: 0 };
  }

  const nextMilestone = getHighestEligibleApprovalMilestone(x);
  if (!nextMilestone) {
    return { shouldSend: false, triggerX: 0 };
  }

  const alreadyTriggered = Array.isArray(trackedCall.approvalMilestonesTriggered)
    ? trackedCall.approvalMilestonesTriggered.includes(nextMilestone)
    : false;

  const currentlyPending =
    trackedCall.approvalMessageId &&
    trackedCall.approvalStatus === 'pending';

  if (currentlyPending && Number(trackedCall.lastApprovalTriggerX || 0) >= nextMilestone) {
    return { shouldSend: false, triggerX: 0 };
  }

  if (alreadyTriggered && Number(trackedCall.lastApprovalTriggerX || 0) >= nextMilestone) {
    return { shouldSend: false, triggerX: 0 };
  }

  return { shouldSend: true, triggerX: nextMilestone };
}

module.exports = {
  PRESET_APPROVAL_LADDER,
  getApprovalTriggerX,
  getApprovalMilestoneLadder,
  getHighestEligibleApprovalMilestone,
  computeApprovalAthX,
  shouldCreateApprovalRequest
};
