const { fetchFakeTokenData } = require('../providers/fakeTokenProvider');
const { fetchRealTokenData } = require('../providers/realTokenProvider');
const { tokenDataBlueprint } = require('../config/tokenDataBlueprint');
const { scannerConfig } = require('../config/scannerConfig');
const { scanFilterConfig } = require('../config/scanFilterConfig');
const { scanSafetyConfig } = require('../config/scanSafetyConfig');

// ----------------------------
// SAFE DEEP MERGE
// ----------------------------
function deepMerge(target, source) {
  const output = { ...target };

  for (const key in source) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key]
    ) {
      output[key] = deepMerge(target[key], source[key]);
    } else {
      output[key] = source[key];
    }
  }

  return output;
}

// ----------------------------
// 🔥 FIX: PRESERVE HOLDER DATA
// ----------------------------
function normalizeTokenData(rawTokenData) {
  const merged = deepMerge(tokenDataBlueprint, rawTokenData);

  // FORCE HOLDER INTEL THROUGH (DO NOT LET BLUEPRINT WIPE IT)
  if (rawTokenData?.holders) {
    merged.holders = {
      ...merged.holders,
      ...rawTokenData.holders
    };
  }

  return merged;
}

// ----------------------------
// SAFETY HELPERS
// ----------------------------
function getHolderMetrics(realData) {
  return {
    devHoldingPercent: Number(realData?.holders?.devHoldingPercent || 0),
    bundleHoldingPercent: Number(realData?.holders?.bundleHoldingPercent || 0),
    top10HolderPercent: Number(realData?.holders?.top10HolderPercent || 0),
    holders: Number(realData?.holders?.holders || 0),
    liquidity: Number(realData?.market?.liquidity || 0)
  };
}

function isTrashReject(realData) {
  const metrics = getHolderMetrics(realData);
  const config = scanSafetyConfig.trashReject;

  return (
    metrics.devHoldingPercent > config.maxDevHoldingPercent ||
    metrics.bundleHoldingPercent > config.maxBundleHoldingPercent ||
    metrics.top10HolderPercent > config.maxTop10HolderPercent ||
    metrics.liquidity < config.minLiquidity ||
    metrics.holders < config.minHolders
  );
}

function isCooldownReject(realData) {
  const metrics = getHolderMetrics(realData);
  const config = scanSafetyConfig.cooldownReject;

  return (
    metrics.devHoldingPercent > config.maxDevHoldingPercent ||
    metrics.bundleHoldingPercent > config.maxBundleHoldingPercent ||
    metrics.top10HolderPercent > config.maxTop10HolderPercent ||
    metrics.liquidity < config.minLiquidity ||
    metrics.holders < config.minHolders
  );
}

function getSafetyDecision(realData) {
  if (isTrashReject(realData)) {
    return {
      status: 'trash',
      retryMinutes: null
    };
  }

  if (isCooldownReject(realData)) {
    return {
      status: 'cooldown',
      retryMinutes: scanSafetyConfig.cooldownReject.retryMinutes
    };
  }

  return {
    status: 'pass',
    retryMinutes: null
  };
}

// ----------------------------
// FILTER HELPERS
// ----------------------------
function passesStandardFilter(realData) {
  const mc = realData?.market?.marketCap || 0;
  const liq = realData?.market?.liquidity || 0;
  const vol = realData?.market?.volume5m || 0;
  const age = realData?.market?.ageMinutes;

  const config = scanFilterConfig.standard;

  return (
    mc >= config.minMarketCap &&
    liq >= config.minLiquidity &&
    vol >= config.minVolume5m &&
    age !== null &&
    age <= config.maxAgeMinutes
  );
}

function passesDeepFilter(realData) {
  const mc = realData?.market?.marketCap || 0;
  const liq = realData?.market?.liquidity || 0;
  const vol = realData?.market?.volume5m || 0;
  const age = realData?.market?.ageMinutes;

  const config = scanFilterConfig.deep;

  return (
    mc >= config.minMarketCap &&
    liq >= config.minLiquidity &&
    vol >= config.minVolume5m &&
    age !== null &&
    age <= config.maxAgeMinutes
  );
}

function determineAutoScanMode(realData) {
  const safetyDecision = getSafetyDecision(realData);

  if (safetyDecision.status !== 'pass') {
    return {
      scanMode: 'reject',
      safetyDecision
    };
  }

  if (passesDeepFilter(realData)) {
    return {
      scanMode: 'deep',
      safetyDecision
    };
  }

  if (passesStandardFilter(realData)) {
    return {
      scanMode: 'standard',
      safetyDecision
    };
  }

  return {
    scanMode: 'lite',
    safetyDecision
  };
}

function determineManualScanMode(mode = 'scan') {
  if (mode === 'ca') return 'standard';
  if (mode === 'scan') return 'deep';
  return 'deep';
}

// ----------------------------
// MANUAL PIPELINE
// ----------------------------
async function getManualRawTokenData(contractAddress, mode = 'scan') {
  const realData = await fetchRealTokenData(contractAddress);
  const scanMode = determineManualScanMode(mode);

  return {
    ...realData,
    scanMode,
    safetyDecision: {
      status: 'manual',
      retryMinutes: null
    }
  };
}

async function getManualTokenData(contractAddress, mode = 'scan') {
  const rawTokenData = await getManualRawTokenData(contractAddress, mode);
  return normalizeTokenData(rawTokenData);
}

// ----------------------------
// AUTO PIPELINE
// ----------------------------
async function getAutoRawTokenData(contractAddress = null) {
  const realData = await fetchRealTokenData(contractAddress);
  const { scanMode, safetyDecision } = determineAutoScanMode(realData);

  return {
    ...realData,
    scanMode,
    safetyDecision
  };
}

async function getAutoTokenData(contractAddress = null) {
  const rawTokenData = await getAutoRawTokenData(contractAddress);
  return normalizeTokenData(rawTokenData);
}

// ----------------------------
// LEGACY
// ----------------------------
async function getRawTokenData(contractAddress = null) {
  const hasContractAddress = !!contractAddress;

  if (hasContractAddress) {
    return getManualRawTokenData(contractAddress, 'scan');
  }

  if (scannerConfig.providerMode === 'real') {
    return getAutoRawTokenData(contractAddress);
  }

  return fetchFakeTokenData(contractAddress);
}

async function getTokenData(contractAddress = null) {
  const rawTokenData = await getRawTokenData(contractAddress);
  return normalizeTokenData(rawTokenData);
}

module.exports = {
  getTokenData,
  getRawTokenData,
  getManualTokenData,
  getManualRawTokenData,
  getAutoTokenData,
  getAutoRawTokenData,
  normalizeTokenData,
  determineAutoScanMode,
  determineManualScanMode,
  passesStandardFilter,
  passesDeepFilter,
  getSafetyDecision,
  isTrashReject,
  isCooldownReject
};