const {
  findUserProfile,
  upsertUserProfile
} = require('./userProfileService');

/**
 * =========================
 * BASIC HELPERS
 * =========================
 */

function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function extractDiscordIdFromMention(input = '') {
  const str = normalizeString(input);
  const match = str.match(/^<@!?(\d+)>$/);

  return match ? match[1] : null;
}

/**
 * =========================
 * RESOLUTION HELPERS
 * =========================
 */

function resolveCallerIdentity({
  discordUserId = null,
  username = '',
  displayName = '',
  rawInput = ''
} = {}) {
  const mentionId = extractDiscordIdFromMention(rawInput);

  const resolvedDiscordId = discordUserId || mentionId || null;
  const resolvedUsername = normalizeString(username);
  const resolvedDisplayName = normalizeString(displayName);

  return findUserProfile({
    discordUserId: resolvedDiscordId,
    username: resolvedUsername || '',
    displayName: resolvedDisplayName || ''
  });
}

function ensureCallerProfile({
  discordUserId = null,
  username = '',
  displayName = ''
} = {}) {
  return upsertUserProfile({
    discordUserId,
    username,
    displayName
  });
}

/**
 * =========================
 * LOOKUP INPUT PARSER
 * =========================
 */

function parseCallerLookupInput(input = '') {
  const raw = normalizeString(input);
  const discordUserId = extractDiscordIdFromMention(raw);

  return {
    raw,
    discordUserId,
    username: discordUserId ? '' : raw,
    displayName: discordUserId ? '' : raw
  };
}

module.exports = {
  extractDiscordIdFromMention,
  resolveCallerIdentity,
  ensureCallerProfile,
  parseCallerLookupInput
};