'use strict';

/** Default "Top Caller" role snowflake (Discord). Override with DISCORD_TOP_CALLER_ROLE_ID. */
const DEFAULT_TOP_CALLER_ROLE_ID = '1489081922666758264';

/**
 * Move the guild Top Caller role to `newDiscordId`, removing it from the previous holder if any.
 * @param {import('discord.js').Client} client
 * @param {string} newDiscordId
 * @param {{ previousDiscordId?: string | null }} [opts]
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function syncTopCallerDiscordRole(client, newDiscordId, opts = {}) {
  const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();
  const roleId = String(
    process.env.DISCORD_TOP_CALLER_ROLE_ID || DEFAULT_TOP_CALLER_ROLE_ID
  ).trim();
  const nextId = String(newDiscordId || '').trim();
  if (!client || !guildId || !roleId || !nextId) {
    return { ok: false, reason: 'missing_env_or_user' };
  }

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    return { ok: false, reason: 'guild_not_found' };
  }

  const prev = opts.previousDiscordId != null ? String(opts.previousDiscordId).trim() : '';

  if (prev && prev !== nextId) {
    const prevMember = await guild.members.fetch(prev).catch(() => null);
    if (prevMember && prevMember.roles.cache.has(roleId)) {
      await prevMember.roles.remove(roleId).catch(() => {});
    }
  }

  const member = await guild.members.fetch(nextId).catch(() => null);
  if (!member) {
    return { ok: false, reason: 'member_not_in_guild' };
  }

  const role = await guild.roles.fetch(roleId).catch(() => null);
  if (!role) {
    return { ok: false, reason: 'role_not_found' };
  }

  if (!member.roles.cache.has(roleId)) {
    await member.roles.add(role).catch(err => {
      console.error('[TopCallerRole] roles.add failed:', err?.message || err);
    });
  }

  return { ok: true };
}

module.exports = {
  syncTopCallerDiscordRole,
  DEFAULT_TOP_CALLER_ROLE_ID
};
