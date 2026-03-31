function determineLifecycleStatus(call, scan) {
  if (!call || !scan) {
    return 'active';
  }

  const firstCalledMarketCap = call.firstCalledMarketCap || 0;
  const currentMarketCap = scan.marketCap || 0;
  const ageMinutes = scan.ageMinutes || 0;

  if (!firstCalledMarketCap || !currentMarketCap) {
    return call.lifecycleStatus || 'active';
  }

  const performancePercent = ((currentMarketCap - firstCalledMarketCap) / firstCalledMarketCap) * 100;

  // ----------------------------
  // HARD ARCHIVE RULE
  // ----------------------------
  // Nothing gets monitored forever
  if (ageMinutes >= 1440) {
    return 'archived';
  }

  // ----------------------------
  // ARCHIVED RULES
  // ----------------------------
  // Dead enough that we no longer care
  if (
    performancePercent <= -80 ||
    (ageMinutes >= 720 && performancePercent <= -60) ||
    (ageMinutes >= 1440 && currentMarketCap < 15000)
  ) {
    return 'archived';
  }

  // ----------------------------
  // STAGNANT RULES
  // ----------------------------
  // Not fully dead, but probably not worth high attention
  if (
    (ageMinutes >= 240 && performancePercent <= -25) ||
    (ageMinutes >= 360 && currentMarketCap < 30000) ||
    (ageMinutes >= 720 && performancePercent < 20)
  ) {
    return 'stagnant';
  }

  // ----------------------------
  // OTHERWISE ACTIVE
  // ----------------------------
  return 'active';
}

function getLifecycleChangeReason(oldStatus, newStatus, scan, call) {
  if (oldStatus === newStatus) return null;

  const firstCalledMarketCap = call?.firstCalledMarketCap || 0;
  const currentMarketCap = scan?.marketCap || 0;
  const ageMinutes = scan?.ageMinutes || 0;

  let performancePercent = null;

  if (firstCalledMarketCap && currentMarketCap) {
    performancePercent = ((currentMarketCap - firstCalledMarketCap) / firstCalledMarketCap) * 100;
  }

  if (newStatus === 'stagnant') {
    return `Moved to stagnant (${performancePercent?.toFixed(1) || 'N/A'}%, ${ageMinutes} min old)`;
  }

  if (newStatus === 'archived') {
    return `Moved to archived (${performancePercent?.toFixed(1) || 'N/A'}%, ${ageMinutes} min old)`;
  }

  if (newStatus === 'active') {
    return `Returned to active (${performancePercent?.toFixed(1) || 'N/A'}%)`;
  }

  return null;
}

module.exports = {
  determineLifecycleStatus,
  getLifecycleChangeReason
};