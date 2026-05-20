'use strict';

const fs = require('fs');
const path = require('path');
const { loadImage } = require('canvas');

const DEFAULT_MG_MARK = path.join(
  __dirname,
  '../branding/0cba4845-0995-4280-be96-efbf30f9010f.png'
);

/** @type {Promise<import('canvas').Image|null>|null} */
let mgMarkCache = null;

/**
 * Resolve MG monogram path (env override for ops).
 * @returns {string}
 */
function resolveMgMarkPath() {
  const custom = String(process.env.X_MILESTONE_MG_LOGO_PATH || '').trim();
  if (custom && fs.existsSync(custom)) return custom;
  if (fs.existsSync(DEFAULT_MG_MARK)) return DEFAULT_MG_MARK;
  const alt = path.join(__dirname, '../branding/mg-mark.png');
  if (fs.existsSync(alt)) return alt;
  return '';
}

/**
 * @returns {Promise<import('canvas').Image|null>}
 */
async function loadMgMarkImage() {
  if (mgMarkCache) return mgMarkCache;
  const p = resolveMgMarkPath();
  if (!p) {
    mgMarkCache = Promise.resolve(null);
    return null;
  }
  mgMarkCache = loadImage(p).catch(() => null);
  return mgMarkCache;
}

function clearMgMarkCache() {
  mgMarkCache = null;
}

module.exports = {
  resolveMgMarkPath,
  loadMgMarkImage,
  clearMgMarkCache,
  DEFAULT_MG_MARK
};
