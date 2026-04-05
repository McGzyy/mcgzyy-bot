const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '..', 'data', 'scannerSettings.json');

function loadScannerSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) {
      const defaults = {
        minMarketCap: 15000,
        minLiquidity: 3500,
        minVolume5m: 400,
        minVolume1h: 2500,
        minTxns5m: 4,
        minTxns1h: 20,
        approvalTriggerX: 4
      };

      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(defaults, null, 2), 'utf8');
      return defaults;
    }

    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[ScannerSettings] Load failed:', err.message);
    return null;
  }
}

function saveScannerSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('[ScannerSettings] Save failed:', err.message);
  }
}

function updateScannerSetting(key, value) {
  const settings = loadScannerSettings();
  if (!settings) return false;

  settings[key] = value;
  saveScannerSettings(settings);

  return true;
}

module.exports = {
  loadScannerSettings,
  saveScannerSettings,
  updateScannerSetting
};