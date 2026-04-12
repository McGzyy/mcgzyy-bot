const path = require('path');
const { readJson, writeJson } = require('./jsonStore');
const { getTrackedCall } = require('./trackedCallsService');

const trackedDevsFilePath = path.join(__dirname, '../data/trackedDevs.json');

const TRACKED_DEVS_CHANNEL_NAMES = ['tracked-devs'];
const DEV_FEED_CHANNEL_NAMES = ['dev-feed'];

/** @type {unknown[]} */
let _devsStore = [];
let _trackedDevsHydrated = false;

async function initTrackedDevsStore() {
  if (_trackedDevsHydrated) return;
  _trackedDevsHydrated = true;
  try {
    const parsed = await readJson(trackedDevsFilePath);
    _devsStore = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    const code = error && /** @type {{ code?: string }} */ (error).code;
    if (code === 'ENOENT') {
      await writeJson(trackedDevsFilePath, []);
      _devsStore = [];
    } else if (error instanceof SyntaxError) {
      console.error('[DevRegistry] Invalid JSON in trackedDevs.json:', error.message);
      _devsStore = [];
    } else {
      console.error('[DevRegistry] Failed to load tracked devs:', /** @type {Error} */ (error).message);
      _devsStore = [];
    }
  }
}

function loadTrackedDevs() {
  if (!_trackedDevsHydrated) {
    throw new Error('[DevRegistry] initTrackedDevsStore() must be awaited before use');
  }
  try {
    return Array.isArray(_devsStore) ? _devsStore : [];
  } catch (error) {
    console.error('[DevRegistry] Failed to load tracked devs:', /** @type {Error} */ (error).message);
    return [];
  }
}

function saveTrackedDevs(devs) {
  if (!_trackedDevsHydrated) {
    throw new Error('[DevRegistry] initTrackedDevsStore() must be awaited before use');
  }
  try {
    _devsStore = Array.isArray(devs) ? devs : [];
    writeJson(trackedDevsFilePath, _devsStore).catch((error) => {
      console.error('[DevRegistry] Failed to save tracked devs:', /** @type {Error} */ (error).message);
    });
  } catch (error) {
    console.error('[DevRegistry] Failed to save tracked devs:', /** @type {Error} */ (error).message);
  }
}

function normalizeWallet(wallet) {
  return String(wallet || '').trim();
}

function isLikelySolWallet(wallet) {
  const clean = normalizeWallet(wallet);
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean);
}

function isTrackedDevsChannel(channelName = '') {
  return TRACKED_DEVS_CHANNEL_NAMES.includes(String(channelName || '').toLowerCase());
}

function isDevFeedChannel(channelName = '') {
  return DEV_FEED_CHANNEL_NAMES.includes(String(channelName || '').toLowerCase());
}

function getTrackedDev(walletAddress) {
  const clean = normalizeWallet(walletAddress);
  const devs = loadTrackedDevs();
  return devs.find(dev => dev.walletAddress === clean) || null;
}

function parseDevInput(text, wallet) {
  const remaining = text.replace(wallet, '').trim();
  if (!remaining) return { nickname: '', note: '' };

  const parts = remaining.split(' ').filter(Boolean);

  const nickname = parts.length > 0 ? parts[0] : '';
  const note = parts.length > 1 ? parts.slice(1).join(' ') : '';

  return { nickname, note };
}

function addTrackedDev({
  walletAddress,
  addedById = null,
  addedByUsername = 'Unknown',
  nickname = '',
  note = '',
  xHandle = ''
}) {
  const clean = normalizeWallet(walletAddress);
  const devs = loadTrackedDevs();

  const existing = devs.find(dev => dev.walletAddress === clean);
  if (existing) return existing;

  const xh = String(xHandle || '').trim();

  const newDev = {
    walletAddress: clean,
    nickname: String(nickname || '').trim(),
    note: String(note || '').trim(),
    ...(xh ? { xHandle: xh } : {}),
    addedById,
    addedByUsername,
    addedAt: new Date().toISOString(),
    isActive: true,
    tags: [],
    previousLaunches: []
  };

  devs.push(newDev);
  saveTrackedDevs(devs);

  return newDev;
}

function removeTrackedDev(walletAddress) {
  const clean = normalizeWallet(walletAddress);
  const devs = loadTrackedDevs();

  const filtered = devs.filter(dev => dev.walletAddress !== clean);
  saveTrackedDevs(filtered);

  return filtered.length !== devs.length;
}

function getAllTrackedDevs() {
  return loadTrackedDevs().filter(dev => dev.isActive !== false);
}

function addLaunchToTrackedDev(walletAddress, launchEntry = {}) {
  const clean = normalizeWallet(walletAddress);
  const devs = loadTrackedDevs();
  const index = devs.findIndex(dev => dev.walletAddress === clean);

  if (index === -1) return null;

  if (!Array.isArray(devs[index].previousLaunches)) {
    devs[index].previousLaunches = [];
  }

  const alreadyExists = devs[index].previousLaunches.some(
    launch => launch.contractAddress === launchEntry.contractAddress
  );

  if (!alreadyExists) {
    devs[index].previousLaunches.push({
      tokenName: launchEntry.tokenName || 'Unknown Token',
      ticker: launchEntry.ticker || 'UNKNOWN',
      contractAddress: launchEntry.contractAddress || null,
      athMarketCap: Number(launchEntry.athMarketCap || 0),
      firstCalledMarketCap: Number(launchEntry.firstCalledMarketCap || 0),
      xFromCall: Number(launchEntry.xFromCall || 0),
      migrated: launchEntry.migrated === true,
      discordMessageId: launchEntry.discordMessageId || null,
      addedAt: launchEntry.addedAt || new Date().toISOString()
    });

    devs[index].previousLaunches.sort((a, b) => {
      return Number(b.athMarketCap || 0) - Number(a.athMarketCap || 0);
    });
  }

  saveTrackedDevs(devs);
  return devs[index];
}

function updateTrackedDev(walletAddress, updates = {}) {
  const clean = normalizeWallet(walletAddress);
  const devs = loadTrackedDevs();
  const index = devs.findIndex(dev => dev.walletAddress === clean);

  if (index === -1) return null;

  devs[index] = {
    ...devs[index],
    ...updates
  };

  saveTrackedDevs(devs);
  return devs[index];
}

function removeLaunchFromTrackedDev(walletAddress, contractAddress) {
  const cleanWallet = normalizeWallet(walletAddress);
  const cleanCa = normalizeWallet(contractAddress);

  const devs = loadTrackedDevs();
  const index = devs.findIndex(dev => dev.walletAddress === cleanWallet);

  if (index === -1) return null;

  if (!Array.isArray(devs[index].previousLaunches)) {
    devs[index].previousLaunches = [];
  }

  devs[index].previousLaunches = devs[index].previousLaunches.filter(
    launch => launch.contractAddress !== cleanCa
  );

  saveTrackedDevs(devs);
  return devs[index];
}

/**
 * =========================
 * DEV RANKING SYSTEM V1
 * =========================
 */

function getTopLaunches(dev, limit = 5) {
  if (!Array.isArray(dev?.previousLaunches)) return [];
  return [...dev.previousLaunches]
    .sort((a, b) => Number(b.athMarketCap || 0) - Number(a.athMarketCap || 0))
    .slice(0, limit);
}

function calculateAverage(numbers = []) {
  const valid = numbers.map(Number).filter(num => Number.isFinite(num) && num > 0);
  if (!valid.length) return 0;
  return valid.reduce((sum, num) => sum + num, 0) / valid.length;
}

/**
 * Whether this launch migrated to Raydium-class pool (stored flag and/or current tracked call).
 * @param {{ migrated?: boolean, contractAddress?: string|null }} launch
 * @returns {boolean}
 */
function isLaunchMigrated(launch) {
  if (launch?.migrated === true) return true;
  const ca = launch?.contractAddress;
  if (!ca) return false;
  const call = getTrackedCall(ca);
  return call?.migrated === true;
}

/**
 * Performance over all coins in previousLaunches (computed; migration uses live tracked call when missing on the launch).
 * @param {object|null} dev
 * @returns {{ coinCount: number, avgAthMc: number, bestAthMc: number, avgX: number, migratedCount: number, migrationRate: number|null }}
 */
function getDevPerformanceStats(dev) {
  const launches = Array.isArray(dev?.previousLaunches) ? dev.previousLaunches : [];
  const coinCount = launches.length;

  if (!coinCount) {
    return {
      coinCount: 0,
      avgAthMc: 0,
      bestAthMc: 0,
      avgX: 0,
      migratedCount: 0,
      migrationRate: null
    };
  }

  const athValues = launches
    .map(l => Number(l?.athMarketCap || 0))
    .filter(n => Number.isFinite(n) && n > 0);
  const xValues = launches
    .map(l => Number(l?.xFromCall || 0))
    .filter(n => Number.isFinite(n) && n > 0);

  let migratedCount = 0;
  for (const launch of launches) {
    if (isLaunchMigrated(launch)) migratedCount += 1;
  }

  return {
    coinCount,
    avgAthMc: athValues.length ? athValues.reduce((a, b) => a + b, 0) / athValues.length : 0,
    bestAthMc: athValues.length ? Math.max(...athValues) : 0,
    avgX: xValues.length ? xValues.reduce((a, b) => a + b, 0) / xValues.length : 0,
    migratedCount,
    migrationRate: migratedCount / coinCount
  };
}

/**
 * Simple risk tier from all-coin migration rate and avg X (same basis as performance block).
 * Reliable: high migration (≥50%) and decent avg X (≥3×).
 * Risky: low migration (<35%) or poor avg X (<2×).
 * Mixed: everything else with at least one coin on file.
 *
 * @param {{ coinCount?: number, migrationRate?: number|null, avgX?: number }} perf
 * @returns {'Reliable'|'Mixed'|'Risky'|null}
 */
function getDevRiskLabel(perf) {
  if (!perf || perf.coinCount === 0) return null;

  const rate = perf.migrationRate;
  const avgX = Number(perf.avgX);

  const highMig =
    typeof rate === 'number' && Number.isFinite(rate) && rate >= 0.5;
  const lowMig =
    typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0.35;
  const decentX = Number.isFinite(avgX) && avgX >= 3;
  const poorX = !Number.isFinite(avgX) || avgX < 2;

  if (highMig && decentX) return 'Reliable';
  if (lowMig || poorX) return 'Risky';
  return 'Mixed';
}

/**
 * @param {string} query
 * @returns {Array<object>}
 */
function findTrackedDevsByLookup(query) {
  const raw = String(query || '').trim();
  if (!raw) return [];

  if (isLikelySolWallet(raw)) {
    const d = getTrackedDev(raw);
    return d ? [d] : [];
  }

  const term = raw.startsWith('@') ? raw.slice(1).trim() : raw;
  const termLower = term.toLowerCase();
  if (!termLower) return [];

  const devs = getAllTrackedDevs();
  const exact = devs.filter(
    d => String(d.nickname || '').trim().toLowerCase() === termLower
  );
  if (exact.length) return exact;

  return devs.filter(d => {
    const nick = String(d.nickname || '').trim().toLowerCase();
    return nick.includes(termLower);
  });
}

function getDevRankData(dev) {
  const topLaunches = getTopLaunches(dev, 5);
  const launchCount = Array.isArray(dev?.previousLaunches) ? dev.previousLaunches.length : 0;

  const avgAth = calculateAverage(topLaunches.map(launch => Number(launch.athMarketCap || 0)));
  const avgX = calculateAverage(topLaunches.map(launch => Number(launch.xFromCall || 0)));

  let score = 0;

  // ATH score (up to 70)
  if (avgAth >= 1000000) score += 70;
  else if (avgAth >= 750000) score += 62;
  else if (avgAth >= 500000) score += 54;
  else if (avgAth >= 250000) score += 44;
  else if (avgAth >= 100000) score += 34;
  else if (avgAth >= 50000) score += 24;
  else if (avgAth >= 25000) score += 14;
  else if (avgAth > 0) score += 8;

  // X score (up to 25)
  if (avgX >= 20) score += 25;
  else if (avgX >= 15) score += 22;
  else if (avgX >= 10) score += 18;
  else if (avgX >= 7) score += 14;
  else if (avgX >= 5) score += 10;
  else if (avgX >= 3) score += 6;
  else if (avgX > 1) score += 3;

  // Launch count bonus (up to 5)
  if (launchCount >= 10) score += 5;
  else if (launchCount >= 7) score += 4;
  else if (launchCount >= 5) score += 3;
  else if (launchCount >= 3) score += 2;
  else if (launchCount >= 1) score += 1;

  score = Math.min(100, Math.round(score));

  let tier = 'Unranked';
  if (score >= 90) tier = 'S Tier';
  else if (score >= 75) tier = 'A Tier';
  else if (score >= 60) tier = 'B Tier';
  else if (score >= 45) tier = 'C Tier';
  else if (score >= 25) tier = 'D Tier';
  else if (score > 0) tier = 'F Tier';

  const performance = getDevPerformanceStats(dev);

  return {
    score,
    tier,
    avgAth,
    avgX,
    launchCount,
    topLaunches,
    performance,
    riskLabel: getDevRiskLabel(performance)
  };
}

function getDevLeaderboard(limit = 10) {
  return getAllTrackedDevs()
    .map(dev => ({
      ...dev,
      rankData: getDevRankData(dev)
    }))
    .sort((a, b) => b.rankData.score - a.rankData.score)
    .slice(0, limit);
}

module.exports = {
  initTrackedDevsStore,
  isTrackedDevsChannel,
  isDevFeedChannel,
  isLikelySolWallet,
  loadTrackedDevs,
  saveTrackedDevs,
  getTrackedDev,
  addTrackedDev,
  removeTrackedDev,
  getAllTrackedDevs,
  parseDevInput,
  addLaunchToTrackedDev,
  updateTrackedDev,
  removeLaunchFromTrackedDev,
  getDevRankData,
  getDevLeaderboard,
  getDevPerformanceStats,
  getDevRiskLabel,
  findTrackedDevsByLookup,
  isLaunchMigrated
};