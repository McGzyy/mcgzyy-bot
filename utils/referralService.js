'use strict';

const path = require('path');
const { readJson, writeJson } = require('./jsonStore');
const { supabase } = require('./supabaseClient');

const REFERRALS_PATH = path.join(__dirname, '../data/referrals.json');
const withJsonFile = writeJson.withFileLock;

/** @type {Record<string, number>} code → last known uses */
const inviteCache = Object.create(null);

/**
 * @param {unknown} ch
 * @returns {boolean}
 */
function isInvitableTextChannel(ch) {
  return (
    !!ch &&
    typeof /** @type {{ isTextBased?: () => boolean }} */ (ch).isTextBased === 'function' &&
    /** @type {{ isTextBased: () => boolean }} */ (ch).isTextBased() &&
    typeof /** @type {{ createInvite?: unknown }} */ (ch).createInvite === 'function'
  );
}

/**
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<import('discord.js').GuildBasedChannel | null>}
 */
async function resolveReferralInviteChannel(guild) {
  if (!guild?.channels?.cache) return null;

  const configuredId = String(process.env.REFERRAL_INVITE_CHANNEL_ID || '').trim();

  if (configuredId) {
    let ch = guild.channels.cache.get(configuredId);
    if (!ch && typeof guild.channels.fetch === 'function') {
      try {
        ch = await guild.channels.fetch(configuredId);
      } catch (_) {
        ch = null;
      }
    }
    if (isInvitableTextChannel(ch)) {
      return /** @type {import('discord.js').GuildBasedChannel} */ (ch);
    }
  }

  if (typeof guild.channels.cache.find !== 'function') {
    console.error(`[Referral] No invitable #verification in guild ${guild.id} (cache missing)`);
    return null;
  }

  const byName = guild.channels.cache.find(c => {
    if (!isInvitableTextChannel(c)) return false;
    return String(c.name || '').toLowerCase() === 'verification';
  });

  if (byName) return byName;

  if (configuredId) {
    console.error(
      `[Referral] No invitable channel: id ${configuredId} and #verification not usable in guild ${guild.id}`
    );
  } else {
    console.error(
      `[Referral] No invitable #verification (set REFERRAL_INVITE_CHANNEL_ID or #verification) in guild ${guild.id}`
    );
  }
  return null;
}

/**
 * @param {unknown} u
 * @returns {{ discordId: string, inviteCode: string, createdAt: string, referrals: Array<{ userId: string, joinedAt: number }> }}
 */
function normalizeUserRecord(u) {
  const discordId = String(u?.discordId || '').trim();
  const inviteCode = String(u?.inviteCode || '').trim();
  const createdAt = String(u?.createdAt || new Date().toISOString());
  const refs = Array.isArray(u?.referrals) ? u.referrals : [];
  const referrals = refs
    .filter(r => r && typeof r === 'object')
    .map(r => ({
      userId: String(r.userId || '').trim(),
      joinedAt: Number(r.joinedAt) || 0
    }))
    .filter(r => r.userId);
  return { discordId, inviteCode, createdAt, referrals };
}

/**
 * @param {unknown} parsed
 * @returns {{ users: ReturnType<typeof normalizeUserRecord>[] }}
 */
function normalizeStore(parsed) {
  if (!parsed || typeof parsed !== 'object') return { users: [] };

  if (Array.isArray(parsed.users) && parsed.users.length) {
    return {
      users: parsed.users.map(normalizeUserRecord).filter(u => u.discordId)
    };
  }

  if (Array.isArray(parsed.referrals) && parsed.referrals.length > 0) {
    /** @type {Map<string, Array<{ userId: string, joinedAt: number }>>} */
    const byReferrer = new Map();
    for (const row of parsed.referrals) {
      if (!row || typeof row !== 'object') continue;
      const ref = String(row.referrerId || '').trim();
      const uid = String(row.referredUserId || '').trim();
      if (!ref || !uid) continue;
      const t = Date.parse(String(row.timestamp || ''));
      if (!byReferrer.has(ref)) byReferrer.set(ref, []);
      byReferrer.get(ref).push({ userId: uid, joinedAt: Number.isFinite(t) ? t : Date.now() });
    }
    const users = [];
    for (const [discordId, referrals] of byReferrer) {
      users.push(
        normalizeUserRecord({
          discordId,
          inviteCode: '',
          createdAt: new Date().toISOString(),
          referrals
        })
      );
    }
    return { users };
  }

  return { users: [] };
}

const LEGACY_INVITES_PATH = path.join(__dirname, '../data/referralInvites.json');

/**
 * Fill empty inviteCode from legacy `referralInvites.json` (in-memory; file may be unused now).
 * @param {{ users: ReturnType<typeof normalizeUserRecord>[] }} store
 * @returns {Promise<void>}
 */
async function mergeInviteCodesFromLegacyFile(store) {
  try {
    const invFile = await readJson(LEGACY_INVITES_PATH);
    if (!Array.isArray(invFile?.invites)) return;
    for (const u of store.users) {
      if (String(u.inviteCode || '').trim()) continue;
      const row = invFile.invites.find(
        r => r && String(r.userId || '').trim() === u.discordId
      );
      const c = String(row?.code || '').trim();
      if (c) u.inviteCode = c;
    }
  } catch (e) {
    const code = e && /** @type {{ code?: string }} */ (e).code;
    if (code !== 'ENOENT' && !(e instanceof SyntaxError)) {
      console.error('[Referral] mergeInviteCodesFromLegacyFile:', /** @type {Error} */ (e).message || e);
    }
  }
}

/**
 * @param {unknown} parsed
 * @returns {Promise<{ users: ReturnType<typeof normalizeUserRecord>[] }>}
 */
async function resolveStoreFromParsed(parsed) {
  const store = normalizeStore(parsed);
  await mergeInviteCodesFromLegacyFile(store);
  return store;
}

/**
 * @returns {Promise<{ users: ReturnType<typeof normalizeUserRecord>[] }>}
 */
async function loadReferrals() {
  try {
    const parsed = await readJson(REFERRALS_PATH);
    return await resolveStoreFromParsed(parsed);
  } catch (e) {
    const code = e && /** @type {{ code?: string }} */ (e).code;
    if (e instanceof SyntaxError) {
      console.error('[Referral] Invalid referrals.json:', e.message);
    } else if (code !== 'ENOENT') {
      console.error('[Referral] loadReferrals:', /** @type {Error} */ (e).message || e);
    }
    return { users: [] };
  }
}

/**
 * @param {{ users: unknown[] }} data
 * @returns {Promise<void>}
 */
async function saveReferrals(data) {
  const users = Array.isArray(data?.users) ? data.users.map(normalizeUserRecord).filter(u => u.discordId) : [];
  await writeJson(REFERRALS_PATH, { users });
}

/**
 * @param {{ users: ReturnType<typeof normalizeUserRecord>[] }} store
 * @returns {Record<string, string>}
 */
function buildCodeToOwnerMap(store) {
  /** @type {Record<string, string>} */
  const map = Object.create(null);
  for (const u of store.users) {
    const c = String(u.inviteCode || '').trim().toLowerCase();
    if (c && u.discordId) map[c] = u.discordId;
  }
  return map;
}

/**
 * @param {string} referredUserId
 * @param {{ users: ReturnType<typeof normalizeUserRecord>[] }} store
 * @returns {boolean}
 */
function isAlreadyReferredGlobally(referredUserId, store) {
  const id = String(referredUserId || '').trim();
  if (!id) return true;
  return store.users.some(u => u.referrals.some(r => r.userId === id));
}

/**
 * @param {string} discordId
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{ discordId: string, inviteCode: string, url: string, createdAt: string }>}
 */
async function getOrCreateUserReferral(discordId, guild) {
  const uid = String(discordId || '').trim();
  if (!uid) {
    console.error('[Referral] Missing discordId');
    return { discordId: '', inviteCode: '', url: '', createdAt: '' };
  }
  if (!guild || !guild.channels?.cache) {
    console.error('[Referral] Invalid guild');
    return { discordId: uid, inviteCode: '', url: '', createdAt: '' };
  }

  try {
    return await withJsonFile(REFERRALS_PATH, async ({ readParsed, writeParsed }) => {
      /** @type {{ users: ReturnType<typeof normalizeUserRecord>[] }} */
      let store = { users: [] };
      try {
        const parsed = await readParsed();
        store = await resolveStoreFromParsed(parsed);
      } catch (e) {
        const code = e && /** @type {{ code?: string }} */ (e).code;
        if (code !== 'ENOENT' && !(e instanceof SyntaxError)) {
          console.error('[Referral] read referrals.json:', /** @type {Error} */ (e).message || e);
        }
      }

      let rec = store.users.find(u => u.discordId === uid);
      if (rec && rec.inviteCode) {
        const code = rec.inviteCode;
        return {
          discordId: uid,
          inviteCode: code,
          url: `https://discord.gg/${code}`,
          createdAt: rec.createdAt
        };
      }

      const channel = await resolveReferralInviteChannel(guild);
      if (!channel) {
        return { discordId: uid, inviteCode: '', url: '', createdAt: '' };
      }

      let inv = null;
      try {
        inv = await channel.createInvite({
          maxAge: 0,
          maxUses: 0,
          unique: true
        });
      } catch (err) {
        console.error('[Referral] createInvite failed:', /** @type {Error} */ (err).message || err);
        return { discordId: uid, inviteCode: '', url: '', createdAt: '' };
      }

      const code = String(inv?.code || '').trim();
      const url = String(inv?.url || '').trim() || (code ? `https://discord.gg/${code}` : '');
      const createdAt = new Date().toISOString();
      const nextRec = normalizeUserRecord({
        discordId: uid,
        inviteCode: code,
        createdAt,
        referrals: rec?.referrals || []
      });

      const users = store.users.filter(u => u.discordId !== uid);
      users.push(nextRec);
      try {
        await writeParsed({ users });
      } catch (werr) {
        console.error('[Referral] write referrals.json failed:', /** @type {Error} */ (werr).message || werr);
      }

      return { discordId: uid, inviteCode: code, url, createdAt };
    });
  } catch (e) {
    console.error('[Referral] getOrCreateUserReferral:', /** @type {Error} */ (e).message || e);
    return { discordId: uid, inviteCode: '', url: '', createdAt: '' };
  }
}

/**
 * @param {import('discord.js').Client} client
 * @returns {Promise<void>}
 */
async function hydrateInviteCacheFromClient(client) {
  try {
    if (!client?.guilds?.cache) return;
    for (const guild of client.guilds.cache.values()) {
      try {
        const coll = await guild.invites.fetch();
        const vanity = String(guild.vanityURLCode || '').trim().toLowerCase();
        for (const inv of coll.values()) {
          try {
            if (!inv) continue;
            const c = String(inv.code || '').trim();
            if (!c) continue;
            if (vanity && c.toLowerCase() === vanity) continue;
            inviteCache[c] = Number(inv.uses) || 0;
          } catch (_) {}
        }
      } catch (err) {
        console.error(
          `[Referral] Startup invites.fetch failed (guild ${guild?.id}):`,
          /** @type {Error} */ (err).message || err
        );
      }
    }
  } catch (e) {
    console.error('[Referral] hydrateInviteCacheFromClient:', /** @type {Error} */ (e).message || e);
  }
}

/**
 * @param {import('discord.js').GuildMember} member
 * @returns {Promise<void>}
 */
async function handleGuildMemberAdd(member) {
  try {
    const guild = member?.guild;
    const client = member.client;
    if (!guild || typeof guild.invites?.fetch !== 'function') return;

    let newInvites = null;
    try {
      newInvites = await guild.invites.fetch();
    } catch (e) {
      console.error('[Referral] invites.fetch on member add:', /** @type {Error} */ (e).message || e);
      return;
    }

    if (!newInvites || newInvites.size === 0) {
      console.log('[Referral] No invites returned after member add — cannot attribute');
      return;
    }

    const vanity = String(guild.vanityURLCode || '').trim().toLowerCase();
    let increasedCode = null;
    let multipleIncrease = false;

    for (const inv of newInvites.values()) {
      try {
        if (!inv) continue;
        const c = String(inv.code || '').trim();
        if (!c) continue;
        if (vanity && c.toLowerCase() === vanity) continue;

        const oldUses = Object.prototype.hasOwnProperty.call(inviteCache, c) ? inviteCache[c] : 0;
        const newUses = Number(inv.uses) || 0;
        if (newUses > oldUses) {
          if (increasedCode !== null && increasedCode !== c) multipleIncrease = true;
          if (!increasedCode) increasedCode = c;
        }
      } catch (_) {}
    }

    if (increasedCode && multipleIncrease) {
      console.log('[Referral] Multiple invites increased — attributing first:', increasedCode);
    }

    if (increasedCode && !member.user?.bot) {
      await withJsonFile(REFERRALS_PATH, async ({ readParsed, writeParsed }) => {
        let store = { users: [] };
        try {
          store = await resolveStoreFromParsed(await readParsed());
        } catch (e) {
          const code = e && /** @type {{ code?: string }} */ (e).code;
          if (code !== 'ENOENT' && !(e instanceof SyntaxError)) {
            console.error('[Referral] read on member add:', /** @type {Error} */ (e).message || e);
          }
        }

        const ownerId = buildCodeToOwnerMap(store)[increasedCode.toLowerCase()];
        const newId = String(member.id || '').trim();

        if (!ownerId) {
          console.log(`[Referral] Invite "${increasedCode}" not tied to a referral owner — skip`);
        } else if (ownerId === newId) {
          console.log(`[Referral] Self-referral blocked: ${newId} used own invite ${increasedCode}`);
        } else if (isAlreadyReferredGlobally(newId, store)) {
          console.log(
            `[Referral] Duplicate blocked: user ${newId} already counted as a referral (rejoin)`
          );
        } else {
          const ownerUser = await client.users.fetch(ownerId).catch(() => null);
          const ownerTag = ownerUser ? ownerUser.tag : ownerId;
          const joinerTag = member.user ? member.user.tag : newId;

          const users = store.users.map(u => ({ ...u, referrals: [...u.referrals] }));
          const idx = users.findIndex(u => u.discordId === ownerId);
          if (idx === -1) {
            console.log(`[Referral] Owner ${ownerId} missing from store — skip append`);
          } else {
            users[idx].referrals.push({ userId: newId, joinedAt: Date.now() });
            await writeParsed({ users });
            try {
              const joinedAt = Date.now();
              const { error: supabaseError } = await supabase.from('referrals').insert({
                owner_discord_id: ownerId,
                referred_user_id: member.id,
                joined_at: joinedAt
              });
              if (supabaseError) {
                console.error('[Referral] Supabase insert:', supabaseError.message || supabaseError);
              }
            } catch (supabaseErr) {
              const msg =
                supabaseErr instanceof Error ? supabaseErr.message : String(supabaseErr);
              console.error('[Referral] Supabase insert:', msg);
            }
            console.log(
              `[Referral] User ${joinerTag} joined using invite ${increasedCode} → credited to ${ownerTag}`
            );
          }
        }
      });
    } else if (member.user?.bot) {
      /* bots ignored for credit; cache still updated below */
    } else if (!increasedCode) {
      console.log('[Referral] No invite use increase detected for this join');
    }

    for (const inv of newInvites.values()) {
      try {
        if (!inv) continue;
        const c = String(inv.code || '').trim();
        if (!c) continue;
        if (vanity && c.toLowerCase() === vanity) continue;
        inviteCache[c] = Number(inv.uses) || 0;
      } catch (_) {}
    }
  } catch (e) {
    console.error('[Referral] handleGuildMemberAdd:', /** @type {Error} */ (e).message || e);
  }
}

/**
 * @param {string} referrerId
 * @returns {Promise<{ total: number, last24h: number, last7d: number, last30d: number }>}
 */
async function getReferralStatsForReferrer(referrerId) {
  const uid = String(referrerId || '').trim();
  const out = { total: 0, last24h: 0, last7d: 0, last30d: 0 };
  if (!uid) return out;

  const store = await loadReferrals();
  const rec = store.users.find(u => u.discordId === uid);
  if (!rec) return out;

  const now = Date.now();
  const msHour = 60 * 60 * 1000;
  const ms24 = 24 * msHour;
  const ms7 = 7 * ms24;
  const ms30 = 30 * ms24;

  for (const r of rec.referrals) {
    out.total += 1;
    const t = Number(r.joinedAt) || 0;
    if (!t) continue;
    const age = now - t;
    if (age < 0) continue;
    if (age <= ms24) out.last24h += 1;
    if (age <= ms7) out.last7d += 1;
    if (age <= ms30) out.last30d += 1;
  }

  return out;
}

/**
 * @param {import('discord.js').Guild|null} guild
 * @param {import('discord.js').Client} discordClient
 * @param {number} [limit]
 * @returns {Promise<Array<{ userId: string, username: string, count: number }>>}
 */
async function getReferralLeaderboardTop(guild, discordClient, limit = 10) {
  const lim = Math.min(50, Math.max(1, Math.floor(Number(limit) || 10)));
  const store = await loadReferrals();
  const sorted = [...store.users]
    .filter(u => u.referrals.length > 0)
    .sort((a, b) => b.referrals.length - a.referrals.length || a.discordId.localeCompare(b.discordId));

  /** @type {Array<{ userId: string, username: string, count: number }>} */
  const out = [];

  for (const u of sorted) {
    if (out.length >= lim) break;
    try {
      const user = await discordClient.users.fetch(u.discordId).catch(() => null);
      if (!user || user.bot) continue;

      let username = user.username;
      if (guild && typeof guild.members.fetch === 'function') {
        const mem = await guild.members.fetch(u.discordId).catch(() => null);
        if (mem) username = mem.displayName || mem.user?.username || username;
      }

      out.push({
        userId: u.discordId,
        username: String(username || 'Unknown').slice(0, 80),
        count: u.referrals.length
      });
    } catch (_) {}
  }

  return out;
}

/**
 * Manually attach referral rows to a referrer (for migrations / fixes).
 * @param {string} ownerDiscordId
 * @param {string[]} userIds
 * @returns {Promise<void>}
 */
async function assignReferralsToUser(ownerDiscordId, userIds) {
  const store = await loadReferrals();

  let user = store.users.find(u => u.discordId === ownerDiscordId);

  if (!user) {
    user = {
      discordId: ownerDiscordId,
      inviteCode: '',
      createdAt: new Date().toISOString(),
      referrals: []
    };
    store.users.push(user);
  }

  const existingIds = new Set(user.referrals.map(r => r.userId));

  const now = Date.now();

  for (const id of userIds) {
    if (!existingIds.has(id) && id !== ownerDiscordId) {
      user.referrals.push({
        userId: id,
        joinedAt: now - Math.floor(Math.random() * 7 * 24 * 60 * 60 * 1000)
      });
    }
  }

  await saveReferrals(store);

  console.log(`[Referral] Assigned ${userIds.length} referrals to ${ownerDiscordId}`);
}

module.exports = {
  REFERRALS_PATH,
  inviteCache,
  loadReferrals,
  saveReferrals,
  getOrCreateUserReferral,
  hydrateInviteCacheFromClient,
  handleGuildMemberAdd,
  getReferralStatsForReferrer,
  getReferralLeaderboardTop,
  assignReferralsToUser
};
