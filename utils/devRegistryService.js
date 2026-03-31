const fs = require('fs');
const path = require('path');

const trackedDevsFilePath = path.join(__dirname, '../data/trackedDevs.json');

const TRACKED_DEVS_CHANNEL_NAMES = ['tracked-devs'];
const DEV_FEED_CHANNEL_NAMES = ['dev-feed'];

function ensureTrackedDevsFile() {
  try {
    if (!fs.existsSync(trackedDevsFilePath)) {
      fs.writeFileSync(trackedDevsFilePath, JSON.stringify([], null, 2));
    }
  } catch (error) {
    console.error('[DevRegistry] Failed to ensure tracked dev file:', error.message);
  }
}

function loadTrackedDevs() {
  try {
    ensureTrackedDevsFile();
    const rawData = fs.readFileSync(trackedDevsFilePath, 'utf-8');
    return JSON.parse(rawData);
  } catch (error) {
    console.error('[DevRegistry] Failed to load tracked devs:', error.message);
    return [];
  }
}

function saveTrackedDevs(devs) {
  try {
    fs.writeFileSync(trackedDevsFilePath, JSON.stringify(devs, null, 2));
  } catch (error) {
    console.error('[DevRegistry] Failed to save tracked devs:', error.message);
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
  note = ''
}) {
  const clean = normalizeWallet(walletAddress);
  const devs = loadTrackedDevs();

  const existing = devs.find(dev => dev.walletAddress === clean);
  if (existing) return existing;

  const newDev = {
    walletAddress: clean,
    nickname: String(nickname || '').trim(),
    note: String(note || '').trim(),
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

  return {
    score,
    tier,
    avgAth,
    avgX,
    launchCount,
    topLaunches
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
  getDevLeaderboard
};