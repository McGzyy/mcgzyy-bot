'use strict';

/**
 * Resolve dashboard/bot staff tier from Discord guild roles (mirrors mcgbot-dashboard `discordStaffTier.ts`).
 * Returns null on API failure so callers can fall back to env id lists.
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

function nameSet(raw) {
  if (!raw || !String(raw).trim()) return new Set();
  return new Set(
    String(raw)
      .split(/[,|]+/)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * @param {string} discordUserId
 * @returns {Promise<string[]|null>} role ids, [] if not in guild, null on transport failure
 */
async function fetchDiscordGuildMemberRoleIds(discordUserId) {
  const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();
  const token = String(process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || '').trim();
  if (!guildId || !token) return null;

  const uid = String(discordUserId || '').trim();
  if (!uid) return null;

  try {
    const memberRes = await fetch(
      `https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(uid)}`,
      { headers: { Authorization: `Bot ${token}` } }
    );

    if (memberRes.status === 404) return [];
    if (!memberRes.ok) {
      console.warn(
        `[discordStaffTier] member fetch failed (${memberRes.status}) for user ${uid.slice(0, 6)}…`
      );
      return null;
    }

    const member = await memberRes.json().catch(() => null);
    if (!member || !Array.isArray(member.roles)) return [];
    return member.roles.map(r => String(r).trim()).filter(Boolean);
  } catch (e) {
    console.warn('[discordStaffTier] unexpected error', e);
    return null;
  }
}

/**
 * @param {string} discordUserId
 * @returns {Promise<'user'|'mod'|'admin'|null>}
 */
async function staffTierFromDiscord(discordUserId) {
  const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();
  const token = String(process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || '').trim();
  if (!guildId || !token) return null;

  const uid = String(discordUserId || '').trim();
  if (!uid) return null;

  try {
    const roleIds = await fetchDiscordGuildMemberRoleIds(uid);
    if (roleIds === null) return null;

    const adminIds = idSet(process.env.DISCORD_ADMIN_ROLE_IDS);
    const modIds = idSet(process.env.DISCORD_MOD_ROLE_IDS);

    if (adminIds.size > 0 || modIds.size > 0) {
      if (roleIds.some(id => adminIds.has(id))) return 'admin';
      if (roleIds.some(id => modIds.has(id))) return 'mod';
      return 'user';
    }

    const rolesRes = await fetch(
      `https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/roles`,
      { headers: { Authorization: `Bot ${token}` } }
    );
    if (!rolesRes.ok) {
      console.warn(`[discordStaffTier] guild roles fetch failed (${rolesRes.status})`);
      return null;
    }

    const rolesArr = await rolesRes.json().catch(() => []);
    const nameById = new Map();
    if (Array.isArray(rolesArr)) {
      for (const raw of rolesArr) {
        if (!raw || typeof raw !== 'object') continue;
        const id = typeof raw.id === 'string' ? raw.id.trim() : '';
        const name = typeof raw.name === 'string' ? raw.name : '';
        if (id) nameById.set(id, name);
      }
    }

    const adminNames = nameSet(process.env.DISCORD_ADMIN_ROLE_NAMES || 'ADMIN');
    const modNames = nameSet(process.env.DISCORD_MOD_ROLE_NAMES || 'MOD');

    let isAdmin = false;
    let isMod = false;
    for (const rid of roleIds) {
      const nm = (nameById.get(rid) || '').trim().toLowerCase();
      if (nm && adminNames.has(nm)) isAdmin = true;
      if (nm && modNames.has(nm)) isMod = true;
    }
    if (isAdmin) return 'admin';
    if (isMod) return 'mod';
    return 'user';
  } catch (e) {
    console.warn('[discordStaffTier] unexpected error', e);
    return null;
  }
}

module.exports = {
  fetchDiscordGuildMemberRoleIds,
  staffTierFromDiscord
};
