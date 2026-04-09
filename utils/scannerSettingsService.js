const fs = require('fs');
const path = require('path');

const settingsFilePath = path.join(__dirname, '../data/scannerSettings.json');

function ensureDataDir() {
  const dir = path.dirname(settingsFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadScannerSettings() {
  try {
    ensureDataDir();

    if (!fs.existsSync(settingsFilePath)) {
      fs.writeFileSync(settingsFilePath, JSON.stringify({}, null, 2), 'utf8');
      return {};
    }

    const raw = fs.readFileSync(settingsFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.error('[ScannerSettings] Failed to load settings:', error.message);
    return {};
  }
}

function updateScannerSetting(key, value) {
  try {
    if (!key || typeof key !== 'string') return false;

    const settings = loadScannerSettings();
    settings[key] = value;

    ensureDataDir();
    fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('[ScannerSettings] Failed to update setting:', error.message);
    return false;
  }
}

module.exports = {
  loadScannerSettings,
  updateScannerSetting
};

