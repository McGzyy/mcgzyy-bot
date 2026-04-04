/**
 * Discord guild checks for X-originated call intake (membership now; roles later).
 * No live X transport here.
 */

function str(v) {
  return v == null ? '' : String(v).trim();
}

/** Optional copy for future X-side replies when the user left the server. */
const X_INTAKE_NOT_IN_GUILD_MESSAGE =
  'You must be a member of the linked Discord server to call from X.';

function configuredIntakeGuildId() {
  return str(process.env.DISCORD_GUILD_ID || process.env.X_INTAKE_GUILD_ID || '');
}

/**
 * Pick which guild to use for intake membership checks.
 * Priority: explicit `guild` → env DISCORD_GUILD_ID / X_INTAKE_GUILD_ID → sole cached guild.
 * @param {import('discord.js').Client|null} client
 * @param {import('discord.js').Guild|null} guild
 * @returns {import('discord.js').Guild|null}
 */
function resolveIntakeGuild(client, guild) {
  if (guild?.id) return guild;
  if (!client?.guilds?.cache) return null;

  const id = configuredIntakeGuildId();
  if (id) {
    return client.guilds.cache.get(id) || null;
  }

  if (client.guilds.cache.size === 1) {
    return client.guilds.cache.first();
  }

  return null;
}

/**
 * Whether the Discord user is currently in the guild (fetch if not cached).
 * @returns {Promise<{ ok: boolean, reason: string, member: import('discord.js').GuildMember|null, error?: string }>}
 */
async function checkXIntakeGuildMembership(guild, discordUserId) {
  const uid = str(discordUserId);
  if (!uid) {
    return { ok: false, reason: 'missing_discord_user_id', member: null };
  }
  if (!guild) {
    return { ok: false, reason: 'guild_context_missing', member: null };
  }

  try {
    let member = guild.members.cache.get(uid);
    if (!member) {
      member = await guild.members.fetch(uid).catch(() => null);
    }

    if (!member) {
      return { ok: false, reason: 'not_in_guild', member: null };
    }

    return { ok: true, reason: 'in_guild', member };
  } catch (err) {
    return {
      ok: false,
      reason: 'guild_member_fetch_failed',
      member: null,
      error: err?.message || String(err)
    };
  }
}

/**
 * Full guild-side trust for X intake: resolve guild + membership (+ optional roles later).
 * @param {object} params
 * @param {import('discord.js').Client|null} [params.client]
 * @param {import('discord.js').Guild|null} [params.guild]
 * @param {string|null} params.discordUserId
 * @param {string[]} [params.requiredRoleIds] — if non-empty, user must have at least one (future use)
 * @returns {Promise<{ ok: boolean, reason: string, guild: import('discord.js').Guild|null, member: import('discord.js').GuildMember|null, error?: string }>}
 */
async function validateXIntakeGuildTrust({
  client = null,
  guild = null,
  discordUserId = null,
  requiredRoleIds = null
} = {}) {
  const resolvedGuild = resolveIntakeGuild(client, guild);
  if (!resolvedGuild) {
    return {
      ok: false,
      reason: 'intake_guild_unresolved',
      guild: null,
      member: null
    };
  }

  const membership = await checkXIntakeGuildMembership(resolvedGuild, discordUserId);
  if (!membership.ok) {
    return {
      ok: false,
      reason: membership.reason,
      guild: resolvedGuild,
      member: null,
      error: membership.error
    };
  }

  const member = membership.member;
  if (Array.isArray(requiredRoleIds) && requiredRoleIds.length > 0) {
    const has = requiredRoleIds.some(roleId => member.roles.cache.has(roleId));
    if (!has) {
      return {
        ok: false,
        reason: 'missing_required_role',
        guild: resolvedGuild,
        member
      };
    }
  }

  return {
    ok: true,
    reason: 'guild_trust_ok',
    guild: resolvedGuild,
    member
  };
}

module.exports = {
  X_INTAKE_NOT_IN_GUILD_MESSAGE,
  configuredIntakeGuildId,
  resolveIntakeGuild,
  checkXIntakeGuildMembership,
  validateXIntakeGuildTrust
};
