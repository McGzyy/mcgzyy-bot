'use strict';

/**
 * Same env lists as mcgbot-dashboard `lib/helpRole.ts` (DISCORD_ADMIN_IDS / DISCORD_MOD_IDS).
 * Used by apiServer internal routes so the secret alone is not enough to read mod queue data.
 */

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

function isModOrAdminDiscordUserId(discordUserId) {
  const r = resolveStaffRole(discordUserId);
  return r === 'mod' || r === 'admin';
}

module.exports = {
  resolveStaffRole,
  isModOrAdminDiscordUserId
};
