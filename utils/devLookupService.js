/**
 * Dev lookup / dev card view model.
 * Read-only enrichment from tracked calls for display (no registry writes).
 *
 * Future alert pipeline can key off `dev.walletAddress` and `enrichedLaunches[].contractAddress`
 * without changing this module’s public shape.
 *
 * For call-time wallet + X resolution, use `resolveTrackedDevIdentity` (see devIdentityResolve.js).
 */

const { getTrackedCall } = require('./trackedCallsService');
const {
  getAllTrackedDevs,
  getDevRankData,
  isLikelySolWallet
} = require('./devRegistryService');
const { normalizeXHandle, isLikelyXHandle } = require('./userProfileService');
const { resolveTrackedDevIdentity } = require('./devIdentityResolve');

function normalizeLookupTerm(term) {
  return String(term || '').trim();
}

function averagePositive(numbers = []) {
  const valid = numbers.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/**
 * @param {object} launch — row from dev.previousLaunches
 * @returns {object} launch + display* fields and enrichedFromTracked flag
 */
function enrichLaunchRow(launch) {
  const ca = launch?.contractAddress ? String(launch.contractAddress).trim() : '';
  const tc = ca ? getTrackedCall(ca) : null;

  const snapAth = Number(launch.athMarketCap || 0);
  const snapFirst = Number(launch.firstCalledMarketCap || 0);
  const snapX = Number(launch.xFromCall || 0);

  if (!tc) {
    return {
      ...launch,
      displayAth: snapAth,
      displayFirstMc: snapFirst,
      displayX: snapX,
      enrichedFromTracked: false,
      lifecycleStatus: null
    };
  }

  const ath = Number(
    tc.ath || tc.athMc || tc.athMarketCap || tc.latestMarketCap || snapAth
  );
  const firstMc = Number(tc.firstCalledMarketCap || snapFirst);
  let displayX = snapX;
  if (firstMc > 0 && ath > 0) {
    displayX = Number((ath / firstMc).toFixed(2));
  }

  return {
    ...launch,
    displayAth: ath,
    displayFirstMc: firstMc,
    displayX,
    enrichedFromTracked: true,
    lifecycleStatus: tc.lifecycleStatus || null
  };
}

/**
 * @param {string} raw — wallet or exact nickname (case-insensitive)
 * @returns {{ dev: object|null, matchedBy?: string, reason?: string, matches?: object[] }}
 */
function findTrackedDevForLookup(raw) {
  const term = normalizeLookupTerm(raw);
  if (!term) {
    return { dev: null, reason: 'empty' };
  }

  if (isLikelySolWallet(term)) {
    const dev = getTrackedDev(term);
    return {
      dev: dev || null,
      matchedBy: 'wallet',
      reason: dev ? undefined : 'not_found'
    };
  }

  const asX = normalizeXHandle(term);
  if (asX && isLikelyXHandle(term)) {
    const byX = getTrackedDevByXHandle(asX);
    if (byX) {
      return { dev: byX, matchedBy: 'x_handle' };
    }
  }

  const lower = term.toLowerCase();
  const matches = getAllTrackedDevs().filter(
    (d) => String(d.nickname || '').trim().toLowerCase() === lower
  );

  if (matches.length === 0) {
    return { dev: null, reason: 'not_found' };
  }
  if (matches.length > 1) {
    return { dev: null, reason: 'ambiguous_nickname', matches };
  }

  return { dev: matches[0], matchedBy: 'nickname' };
}

/**
 * @param {object} dev — tracked dev record
 * @returns {object|null} view model for embeds
 */
function buildDevLookupView(dev) {
  if (!dev?.walletAddress) return null;

  const enrichedLaunches = (Array.isArray(dev.previousLaunches) ? dev.previousLaunches : []).map(
    enrichLaunchRow
  );

  const byAth = [...enrichedLaunches].sort(
    (a, b) => Number(b.displayAth || 0) - Number(a.displayAth || 0)
  );
  const byDate = [...enrichedLaunches].sort(
    (a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime()
  );

  const top5 = byAth.slice(0, 5);
  const displayAvgAthTop5 = averagePositive(top5.map((l) => l.displayAth));
  const displayAvgXTop5 = averagePositive(top5.map((l) => l.displayX));

  return {
    dev,
    /** Same scoring as today; not recomputed from enriched rows */
    rankData: getDevRankData(dev),
    enrichedLaunches,
    bestLaunch: byAth[0] || null,
    topByAth: top5,
    recentByDate: byDate.slice(0, 5),
    displayAvgAthTop5,
    displayAvgXTop5,
    /** Stable key for future alert subscriptions */
    alertRegistryKey: String(dev.walletAddress)
  };
}

module.exports = {
  findTrackedDevForLookup,
  buildDevLookupView,
  enrichLaunchRow,
  resolveTrackedDevIdentity
};
