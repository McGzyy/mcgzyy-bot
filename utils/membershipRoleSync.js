function truthy(s) {
  return /^1|true|yes$/i.test(String(s || '').trim());
}

function configuredRoleName() {
  return String(process.env.PREMIUM_MEMBER_ROLE_NAME || '').trim();
}

function membershipQualifies(membership) {
  const status = String(membership?.status || 'none').toLowerCase();
  return status === 'active' || status === 'trial' || status === 'comped';
}

async function syncMembershipRole(guild, userId, membership, options = {}) {
  try {
    if (!guild) {
      return { ok: false, changed: false, action: 'skip', reason: 'no_guild' };
    }
    const uid = userId ? String(userId) : '';
    if (!uid) {
      return { ok: false, changed: false, action: 'skip', reason: 'missing_user_id' };
    }

    const roleName = configuredRoleName();
    if (!roleName) {
      return { ok: true, changed: false, action: 'skip', reason: 'role_not_configured' };
    }

    const role = guild.roles?.cache?.find(r => String(r?.name || '') === roleName) || null;
    if (!role) {
      return { ok: false, changed: false, action: 'skip', reason: 'role_not_found', roleName };
    }

    const member = await guild.members.fetch(uid).catch(() => null);
    if (!member) {
      return { ok: false, changed: false, action: 'skip', reason: 'member_not_found' };
    }

    const shouldHave = membershipQualifies(membership);
    const has = member.roles.cache.has(role.id);

    if (shouldHave && !has) {
      await member.roles.add(role).catch(err => {
        throw new Error(`role_add_failed:${err?.message || String(err)}`);
      });
      if (options.log !== false) {
        console.log('[MemberRoleSync] add', { userId: uid, roleName });
      }
      return { ok: true, changed: true, action: 'add', roleName };
    }

    if (!shouldHave && has) {
      await member.roles.remove(role).catch(err => {
        throw new Error(`role_remove_failed:${err?.message || String(err)}`);
      });
      if (options.log !== false) {
        console.log('[MemberRoleSync] remove', { userId: uid, roleName });
      }
      return { ok: true, changed: true, action: 'remove', roleName };
    }

    return { ok: true, changed: false, action: 'noop', roleName };
  } catch (error) {
    return {
      ok: false,
      changed: false,
      action: 'error',
      reason: error?.message || String(error)
    };
  }
}

module.exports = {
  configuredRoleName,
  membershipQualifies,
  syncMembershipRole
};

