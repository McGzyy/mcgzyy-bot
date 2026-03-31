const { generateRealScan } = require('./scannerEngine');
const { autoCallConfig } = require('../config/autoCallConfig');
const { scanFilterConfig } = require('../config/scanFilterConfig');
const { createAutoCallEmbed } = require('./alertEmbeds');
const {
  saveTrackedCall,
  getTrackedCall,
  updateTrackedCallData
} = require('./trackedCallsService');
const { fetchGeckoTerminalCandidatePools } = require('../providers/geckoTerminalProvider');
const { enqueueAlert } = require('./alertQueue');

let isRunning = false;
let intervalHandle = null;

// memory state
const recentlyCalled = new Map();
let callsThisHour = 0;
let lastHourReset = Date.now();

/**
 * =========================
 * HELPERS
 * =========================
 */

function now() {
  return Date.now();
}

function minutesAgo(ms) {
  return (now() - ms) / (1000 * 60);
}

function resetHourlyCounterIfNeeded() {
  if (minutesAgo(lastHourReset) >= 60) {
    callsThisHour = 0;
    lastHourReset = now();
  }
}

function isDuplicate(contractAddress) {
  if (!autoCallConfig.dedupe.preventDuplicateCalls) return false;

  const lastCall = recentlyCalled.get(contractAddress);
  if (!lastCall) return false;

  return minutesAgo(lastCall) < autoCallConfig.dedupe.cooldownMinutes;
}

function markCalled(contractAddress) {
  recentlyCalled.set(contractAddress, now());
}

function debugEnabled() {
  return !!autoCallConfig.debug?.enabled;
}

function logDebug(...args) {
  if (debugEnabled()) {
    console.log('[AutoCall DEBUG]', ...args);
  }
}

/**
 * =========================
 * 🚨 SANITY FILTERS
 * =========================
 */

function getSanityRejectReason(scan) {
  const cfg = autoCallConfig.sanity;

  const mc = Number(scan.marketCap || 0);
  const liq = Number(scan.liquidity || 0);
  const vol5 = Number(scan.volume5m || 0);
  const vol1 = Number(scan.volume1h || 0);
  const ratio5 = Number(scan.buySellRatio5m || 0);
  const ratio1 = Number(scan.buySellRatio1h || 0);
  const age = Number(scan.ageMinutes || 0);

  if (!mc || !liq) return 'sanity_missing_core';

  /**
   * =========================
   * 🚨 BAD LAUNCH SHAPE FILTER
   * =========================
   */

  // Ultra early + already high → very suspicious
  if (age <= 3 && mc >= 50000) return 'sanity_bad_launch_ultra_early';

  // Early + high MC → likely vertical launch
  if (age <= 5 && mc >= 70000) return 'sanity_bad_launch_early';

  // Still young but already inflated
  if (age <= 8 && mc >= 100000) return 'sanity_bad_launch_inflated';

  /**
   * =========================
   * EXISTING SANITY CHECKS
   * =========================
   */

  if (ratio5 > cfg.maxBuySellRatio5m) return 'sanity_ratio5_absurd';
  if (ratio1 > cfg.maxBuySellRatio1h) return 'sanity_ratio1_absurd';

  const liqToMc = liq / mc;
  if (liqToMc > cfg.maxLiquidityToMarketCapRatio) return 'sanity_liq_too_high';
  if (liqToMc < cfg.minLiquidityToMarketCapRatio) return 'sanity_liq_too_low';

  const vol5ToLiq = liq > 0 ? vol5 / liq : 0;
  const vol1ToLiq = liq > 0 ? vol1 / liq : 0;

  if (vol5ToLiq > cfg.maxVolumeToLiquidityRatio5m) return 'sanity_vol5_spike';
  if (vol1ToLiq > cfg.maxVolumeToLiquidityRatio1h) return 'sanity_vol1_spike';

  if (vol5ToLiq < cfg.minUniqueVolumeToLiquidityRatio) return 'sanity_no_activity';

  if (mc < cfg.minMeaningfulMarketCap) return 'sanity_low_mc';
  if (liq < cfg.minMeaningfulLiquidity) return 'sanity_low_liq';

  return null;
}

/**
 * =========================
 * 🧠 NAMING FILTERS
 * =========================
 */

function getNamingRejectReason(scan) {
  const cfg = autoCallConfig.naming;

  const name = String(scan.tokenName || '').toLowerCase().trim();
  const ticker = String(scan.ticker || '').toLowerCase().trim();

  if (!name || !ticker) return 'naming_missing';

  if (cfg.blockedTokenNames.includes(name)) return 'naming_blocked_name';
  if (cfg.blockedTickers.includes(ticker)) return 'naming_blocked_ticker';

  if (name.length < cfg.minTokenNameLength) return 'naming_short_name';
  if (ticker.length < cfg.minTickerLength) return 'naming_short_ticker';
  if (ticker.length > cfg.maxTickerLength) return 'naming_long_ticker';

  return null;
}

/**
 * =========================
 * PROFILE FILTER
 * =========================
 */

function getProfileRejectReason(scan, profileName) {
  const profile = autoCallConfig.profiles[profileName];
  if (!profile) return 'missing_profile';

  if (scan.entryScore < profile.minScore) return 'profile_score';
  if (scan.liquidity < profile.minLiquidity) return 'profile_liquidity';
  if (scan.volume5m < profile.minVolume5m) return 'profile_volume5m';
  if (scan.buySellRatio5m < profile.minBuySellRatio5m) return 'profile_ratio';
  if (scan.ageMinutes > profile.maxAgeMinutes) return 'profile_age';

  return null;
}

/**
 * =========================
 * GLOBAL FILTER
 * =========================
 */

function getGlobalRejectReason(scan, profileName) {
  const filter = scanFilterConfig.autoCall[profileName];
  if (!filter) return 'missing_global_filter';

  if (scan.marketCap < filter.minMarketCap) return 'global_min_mc';
  if (scan.marketCap > filter.maxMarketCap) return 'global_max_mc';
  if (scan.liquidity < filter.minLiquidity) return 'global_liq';
  if (scan.volume5m < filter.minVolume5m) return 'global_vol5';
  if (scan.volume1h < filter.minVolume1h) return 'global_vol1';
  if (scan.buySellRatio5m < filter.minBuySellRatio5m) return 'global_ratio';
  if (scan.ageMinutes > filter.maxAgeMinutes) return 'global_age';
  if (scan.entryScore < filter.minScore) return 'global_score';

  return null;
}

/**
 * =========================
 * MOMENTUM FILTER
 * =========================
 */

function getMomentumRejectReason(scan) {
  const cfg = autoCallConfig.momentum;

  if (cfg.blockBearish && scan.tradePressure === 'Bearish') return 'momentum_bearish';
  if (cfg.requirePositivePressure && scan.tradePressure === 'Balanced') return 'momentum_neutral';

  return null;
}

/**
 * =========================
 * TRACKING
 * =========================
 */

function shouldTrackAutoCall(scan) {
  if (!scan?.contractAddress) return false;

  const existing = getTrackedCall(scan.contractAddress);
  if (existing && existing.isActive !== false) return false;

  return true;
}

function trackAutoCall(scan) {
  if (!shouldTrackAutoCall(scan)) return null;
  return saveTrackedCall(scan, 'AUTO_BOT', 'Auto Bot');
}

/**
 * =========================
 * RANKING
 * =========================
 */

function getPasserRankScore(scan) {
  const score = Number(scan.entryScore) || 0;
  const liquidity = Number(scan.liquidity) || 0;
  const volume5m = Number(scan.volume5m) || 0;
  const ratio = Number(scan.buySellRatio5m) || 0;
  const age = Number(scan.ageMinutes) || 9999;

  const ageBonus = Math.max(0, 180 - age);

  return (
    (score * 1000) +
    (volume5m * 2) +
    (liquidity * 0.3) +
    (ratio * 2000) +
    (ageBonus * 50)
  );
}

/**
 * =========================
 * MAIN LOOP
 * =========================
 */

async function runAutoCallCycle(channel) {
  if (!channel) return;

  if (autoCallConfig.failsafes?.emergencyStop) {
    console.log('[AutoCall] Emergency stop active');
    return;
  }

  resetHourlyCounterIfNeeded();

  const profileName = autoCallConfig.defaultProfile;
  const profile = autoCallConfig.profiles[profileName];
  const maxPerCycle = autoCallConfig.loop.maxCallsPerCycle;

  const rejectCounts = {};
  const passers = [];

  console.log(`[AutoCall] Fetching GeckoTerminal candidates (${profileName})...`);

  let candidates = [];

  try {
    candidates = await fetchGeckoTerminalCandidatePools();
  } catch (err) {
    console.error('[AutoCall] Failed to fetch candidates:', err.message);
    return;
  }

  for (const candidate of candidates) {
    if (!candidate?.contractAddress) continue;
    if (isDuplicate(candidate.contractAddress)) continue;
    if (callsThisHour >= profile.maxCallsPerHour) break;

    let scan;

    try {
      scan = await generateRealScan(candidate.contractAddress, candidate);
    } catch (err) {
      rejectCounts.scan_failed = (rejectCounts.scan_failed || 0) + 1;
      logDebug(`Scan failed for ${candidate.contractAddress}: ${err.message}`);
      continue;
    }

    if (!scan || !scan.contractAddress) continue;

    const sanityReject = getSanityRejectReason(scan);
    if (sanityReject) {
      rejectCounts[sanityReject] = (rejectCounts[sanityReject] || 0) + 1;
      continue;
    }

    if (autoCallConfig.alerts.skipUnknownTokens) {
      const namingReject = getNamingRejectReason(scan);
      if (namingReject) {
        rejectCounts[namingReject] = (rejectCounts[namingReject] || 0) + 1;
        continue;
      }
    }

    const profileReject = getProfileRejectReason(scan, profileName);
    if (profileReject) {
      rejectCounts[profileReject] = (rejectCounts[profileReject] || 0) + 1;
      continue;
    }

    const globalReject = getGlobalRejectReason(scan, profileName);
    if (globalReject) {
      rejectCounts[globalReject] = (rejectCounts[globalReject] || 0) + 1;
      continue;
    }

    const momentumReject = getMomentumRejectReason(scan);
    if (momentumReject) {
      rejectCounts[momentumReject] = (rejectCounts[momentumReject] || 0) + 1;
      continue;
    }

    passers.push({
      scan,
      rankScore: getPasserRankScore(scan)
    });
  }

  passers.sort((a, b) => b.rankScore - a.rankScore);

  const selected = passers.slice(0, maxPerCycle);

  for (const item of selected) {
    const scan = item.scan;

    enqueueAlert(async () => {
      const embed = createAutoCallEmbed(scan, profileName);

      const sentMessage = await channel.send({ embeds: [embed] });

      const tracked = trackAutoCall(scan);

      if (tracked && sentMessage?.id) {
        updateTrackedCallData(scan.contractAddress, {
          discordMessageId: sentMessage.id
        });
      }

      markCalled(scan.contractAddress);
      callsThisHour++;
    }, {
      type: 'auto_call',
      contractAddress: scan.contractAddress
    });
  }

  console.log(`[AutoCall] Cycle complete — queued ${selected.length}`);

  if (debugEnabled()) {
    console.log('Reject Summary:', rejectCounts);
  }
}

/**
 * =========================
 * START LOOP
 * =========================
 */

function startAutoCallEngine(channel) {
  if (isRunning) return;

  isRunning = true;

  console.log('[AutoCall] Started');

  runAutoCallCycle(channel);

  intervalHandle = setInterval(() => {
    runAutoCallCycle(channel);
  }, autoCallConfig.loop.intervalMs);
}

function stopAutoCallEngine() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }

  isRunning = false;
}

module.exports = {
  startAutoCallEngine,
  stopAutoCallEngine,
  runAutoCallCycle
};