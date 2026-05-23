'use strict';

/**
 * Staff gate for bot internal APIs — mirrors mcgbot-dashboard `lib/helpRole.ts`:
 * env id lists (DISCORD_ADMIN_IDS / DISCORD_MOD_IDS) merged with live Discord guild roles when configured.
 */

const { staffTierFromDiscord } = require('./discordStaffTierNode');

function idSet(raw) {
  if (!raw || !String(raw).trim()) return new Set();
  return new Set(
    String(raw)
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean)
  );
}

/** @returns {'user'|'mod'|'admin'} */
function resolveStaffRole(discordUserId) {
  const id = String(discordUserId || '').trim();
  if (!id) return 'user';
  const admins = idSet(process.env.DISCORD_ADMIN_IDS);
  const mods = idSet(process.env.DISCORD_MOD_IDS);
  if (admins.has(id)) return 'admin';
  if (mods.has(id)) return 'mod';
  return 'user';
}

function tierRank(t) {
  if (t === 'admin') return 2;
  if (t === 'mod') return 1;
  return 0;
}

function mergeStaffTiers(a, b) {
  return tierRank(a) >= tierRank(b) ? a : b;
}

/**
 * @param {'user'|'mod'|'admin'} tier
 */
function meetsModerationMinTier(tier) {
  const min = String(process.env.MODERATION_MIN_TIER || 'mod')
    .trim()
    .toLowerCase();
  if (min === 'admin') return tier === 'admin';
  return tier === 'mod' || tier === 'admin';
}

/**
 * @param {string} discordUserId
 * @returns {Promise<'user'|'mod'|'admin'>}
 */
async function resolveStaffRoleAsync(discordUserId) {
  const envTier = resolveStaffRole(discordUserId);
  const fromDiscord = await staffTierFromDiscord(discordUserId);
  if (fromDiscord === 'admin' || fromDiscord === 'mod' || fromDiscord === 'user') {
    return mergeStaffTiers(fromDiscord, envTier);
  }
  return envTier;
}

function isModOrAdminDiscordUserId(discordUserId) {
  return meetsModerationMinTier(resolveStaffRole(discordUserId));
}

/**
 * @param {string} discordUserId
 */
async function isModOrAdminDiscordUserIdAsync(discordUserId) {
  const tier = await resolveStaffRoleAsync(discordUserId);
  return meetsModerationMinTier(tier);
}

function isAdminDiscordUserId(discordUserId) {
  return resolveStaffRole(discordUserId) === 'admin';
}

module.exports = {
  resolveStaffRole,
  resolveStaffRoleAsync,
  meetsModerationMinTier,
  isModOrAdminDiscordUserId,
  isModOrAdminDiscordUserIdAsync,
  isAdminDiscordUserId
};
