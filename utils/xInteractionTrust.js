/**
 * Trust helpers for future X mention / interaction flows (no ingestion here).
 * Maps tweet author handle → mod-verified Discord profile.
 */

const {
  getUserProfileByVerifiedXHandle,
  normalizeXHandle
} = require('./userProfileService');

/** Reply copy when the author is not linked to a mod-verified X handle in Discord. */
const X_UNVERIFIED_USER_REPLY_MESSAGE =
  'Verify your X in Discord to use this feature.';

/**
 * Normalize handle from X API `username` or pasted @mention text.
 * @param {string} raw
 * @returns {string}
 */
function normalizeXAuthorHandle(raw) {
  return normalizeXHandle(raw);
}

/**
 * Whether an X account may use trusted bot features (e.g. future @mcgbot CA intake).
 * @param {string} authorHandle — X API author username or equivalent
 * @returns {{
 *   allowed: boolean,
 *   reason: 'verified' | 'not_verified' | 'invalid_handle',
 *   replyMessage: string | null,
 *   profile: object | null,
 *   discordUserId: string | null
 * }}
 */
function getXVerifiedTrustStatus(authorHandle) {
  const handle = normalizeXHandle(authorHandle);
  if (!handle) {
    return {
      allowed: false,
      reason: 'invalid_handle',
      replyMessage: X_UNVERIFIED_USER_REPLY_MESSAGE,
      profile: null,
      discordUserId: null
    };
  }

  const profile = getUserProfileByVerifiedXHandle(handle);
  if (!profile) {
    return {
      allowed: false,
      reason: 'not_verified',
      replyMessage: X_UNVERIFIED_USER_REPLY_MESSAGE,
      profile: null,
      discordUserId: null
    };
  }

  return {
    allowed: true,
    reason: 'verified',
    replyMessage: null,
    profile,
    discordUserId: profile.discordUserId ? String(profile.discordUserId) : null
  };
}

module.exports = {
  X_UNVERIFIED_USER_REPLY_MESSAGE,
  normalizeXAuthorHandle,
  getXVerifiedTrustStatus
};
