'use strict';

const fs = require('fs');
const path = require('path');
const { loadImage } = require('canvas');

const DEFAULT_MG_MARK = path.join(
  __dirname,
  '../branding/0cba4845-0995-4280-be96-efbf30f9010f.png'
);

/** Place McGBot profile PNG here or set `X_MILESTONE_MCGBOT_AVATAR_PATH`. */
const DEFAULT_MCGBOT_AVATAR = path.join(__dirname, '../branding/mcgbot-avatar.png');

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

/**
 * McGBot avatar for milestone cards (bot_call caller row).
 * @returns {string}
 */
function resolveMcGBotAvatarPath() {
  const custom = String(process.env.X_MILESTONE_MCGBOT_AVATAR_PATH || '').trim();
  if (custom && fs.existsSync(custom)) return custom;
  if (fs.existsSync(DEFAULT_MCGBOT_AVATAR)) return DEFAULT_MCGBOT_AVATAR;
  return '';
}

/** @type {Promise<import('canvas').Image|null>|null} */
let mcgbotAvatarCache = null;

/**
 * @returns {Promise<import('canvas').Image|null>}
 */
async function loadMcGBotAvatarImage() {
  const p = resolveMcGBotAvatarPath();
  if (!p) {
    mcgbotAvatarCache = Promise.resolve(null);
    return null;
  }
  if (!mcgbotAvatarCache) {
    mcgbotAvatarCache = loadImage(p).catch(() => null);
  }
  return mcgbotAvatarCache;
}

function clearMcGBotAvatarCache() {
  mcgbotAvatarCache = null;
}

module.exports = {
  resolveMgMarkPath,
  loadMgMarkImage,
  clearMgMarkCache,
  DEFAULT_MG_MARK,
  resolveMcGBotAvatarPath,
  loadMcGBotAvatarImage,
  clearMcGBotAvatarCache,
  DEFAULT_MCGBOT_AVATAR
};
