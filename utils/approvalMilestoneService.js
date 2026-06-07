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
 *    - Initial **X** anchor on mod approve when ATH× is below the broadcast ladder (default
 *      10×+): `resolveApprovalAnchorMilestone` in `xMilestonePublish.js` uses the highest eligible
 *      approval rung (e.g. 8×). Later X posts use the broadcast ladder as quote updates.
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
 * Best-effort ATH market cap for approval / X milestone math.
 * Monitor updates `athMc` every tick; legacy `ath` from the initial scan can stay frozen
 * and must not shadow a higher rolling ATH.
 */
function resolveAthMarketCapForApproval(trackedCall) {
  if (!trackedCall) return 0;

  const candidates = [
    trackedCall.athMc,
    trackedCall.athMarketCap,
    trackedCall.ath,
    trackedCall.latestMarketCap,
    trackedCall.firstCalledMarketCap,
  ]
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (!candidates.length) return 0;
  return Math.max(...candidates);
}

/**
 * ATH multiple from first called MC (monitor uses the same ATH MC resolution).
 */
function computeApprovalAthX(trackedCall) {
  if (!trackedCall) return 0;

  const ath = resolveAthMarketCapForApproval(trackedCall);
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

/** Mod decisions that must never re-open #mod-approvals. */
function isTerminalApprovalStatus(status) {
  const s = String(status || '').toLowerCase();
  return s === 'approved' || s === 'denied' || s === 'excluded';
}

/** Active Discord card still awaiting mod action at this ladder rung (or higher). */
function hasLiveModApprovalCard(trackedCall, nextMilestone) {
  if (!trackedCall) return false;
  if (String(trackedCall.approvalStatus || '').toLowerCase() !== 'pending') return false;
  if (!trackedCall.approvalMessageId) return false;
  return Number(trackedCall.lastApprovalTriggerX || 0) >= nextMilestone;
}

/**
 * @param {object} trackedCall
 * @param {number} [currentX] — if omitted, uses computeApprovalAthX(trackedCall)
 */
function shouldCreateApprovalRequest(trackedCall, currentX = null) {
  if (!trackedCall) return { shouldSend: false, triggerX: 0 };

  const approvalStatus = String(trackedCall.approvalStatus || '').toLowerCase();
  if (isTerminalApprovalStatus(approvalStatus)) {
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

  if (hasLiveModApprovalCard(trackedCall, nextMilestone)) {
    return { shouldSend: false, triggerX: 0 };
  }

  const lastCardX = Number(trackedCall.lastApprovalTriggerX || 0);

  // Higher ladder rung, or same rung after expire / missed card — re-queue for mods.
  if (nextMilestone >= lastCardX) {
    return { shouldSend: true, triggerX: nextMilestone };
  }

  return { shouldSend: false, triggerX: 0 };
}

module.exports = {
  PRESET_APPROVAL_LADDER,
  getApprovalTriggerX,
  getApprovalMilestoneLadder,
  getHighestEligibleApprovalMilestone,
  resolveAthMarketCapForApproval,
  computeApprovalAthX,
  shouldCreateApprovalRequest,
  isTerminalApprovalStatus,
  hasLiveModApprovalCard,
};
