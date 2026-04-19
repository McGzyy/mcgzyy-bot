'use strict';

const { normalizeXHandle } = require('./userProfileService');

/**
 * One-time code the user pastes into an X DM to @X_BOT_USERNAME.
 * @param {string} _discordUserId
 * @param {string} handle
 */
function generateXVerificationCode(_discordUserId, handle) {
  const suffix = Math.floor(100000 + Math.random() * 900000);
  const h = normalizeXHandle(handle).toUpperCase();
  return `MCGZYY-${h}-${suffix}`.slice(0, 32);
}

module.exports = { generateXVerificationCode };
