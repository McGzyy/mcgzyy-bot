'use strict';

const { createClient } = require('@supabase/supabase-js');

const CACHE_MS = 90_000;
/** @type {Map<string, { tier: string, exp: number }>} */
const tierCache = new Map();

function getSupabaseServiceRole() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

function idSet(raw) {
  if (!raw || !String(raw).trim()) return new Set();
  return new Set(
    String(raw)
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean)
  );
}

function resolveHelpTier(discordUserId) {
  const id = String(discordUserId || '').trim();
  if (!id) return 'user';
  const admins = idSet(process.env.DISCORD_ADMIN_IDS);
  const mods = idSet(process.env.DISCORD_MOD_IDS);
  if (admins.has(id)) return 'admin';
  if (mods.has(id)) return 'mod';
  return 'user';
}

function subscriptionActiveUntil(end) {
  if (!end) return false;
  const t = new Date(end).getTime();
  return Number.isFinite(t) && t > Date.now();
}

function utcDayStartIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

async function isSubscriptionExempt(discordId) {
  const id = String(discordId || '').trim();
  if (!id) return false;
  if (idSet(process.env.SUBSCRIPTION_EXEMPT_DISCORD_IDS).has(id)) return true;
  const tier = resolveHelpTier(id);
  if (tier === 'admin' || tier === 'mod') {
    const staffOff = String(process.env.SUBSCRIPTION_EXEMPT_STAFF ?? '')
      .trim()
      .toLowerCase();
    if (staffOff === '0' || staffOff === 'false' || staffOff === 'no' || staffOff === 'off') {
      return false;
    }
    return true;
  }
  return false;
}

async function getSubscriptionEnd(discordId) {
  const sb = getSupabaseServiceRole();
  if (!sb) return null;
  const { data, error } = await sb
    .from('subscriptions')
    .select('current_period_end')
    .eq('discord_id', String(discordId).trim())
    .maybeSingle();
  if (error || !data) return null;
  return typeof data.current_period_end === 'string' ? data.current_period_end : null;
}

async function getPlanProductTier(planId) {
  const sb = getSupabaseServiceRole();
  if (!sb || !planId) return 'basic';
  const { data, error } = await sb
    .from('subscription_plans')
    .select('product_tier')
    .eq('id', String(planId))
    .maybeSingle();
  if (error || !data) return 'basic';
  const t = String(data.product_tier || '')
    .trim()
    .toLowerCase();
  return t === 'pro' ? 'pro' : 'basic';
}

/**
 * @returns {'basic'|'pro'}
 */
async function resolveUserProductTier(discordId) {
  const id = String(discordId || '').trim();
  if (!id) return 'basic';

  const now = Date.now();
  const hit = tierCache.get(id);
  if (hit && hit.exp > now) return hit.tier;

  const help = resolveHelpTier(id);
  if (help === 'admin' || help === 'mod') {
    tierCache.set(id, { tier: 'pro', exp: now + CACHE_MS });
    return 'pro';
  }

  if (await isSubscriptionExempt(id)) {
    tierCache.set(id, { tier: 'pro', exp: now + CACHE_MS });
    return 'pro';
  }

  const end = await getSubscriptionEnd(id);
  if (!subscriptionActiveUntil(end)) {
    tierCache.set(id, { tier: 'basic', exp: now + CACHE_MS });
    return 'basic';
  }

  const sb = getSupabaseServiceRole();
  if (!sb) {
    tierCache.set(id, { tier: 'basic', exp: now + CACHE_MS });
    return 'basic';
  }

  const { data: sub, error } = await sb
    .from('subscriptions')
    .select('plan_id')
    .eq('discord_id', id)
    .maybeSingle();

  if (error || !sub?.plan_id) {
    tierCache.set(id, { tier: 'basic', exp: now + CACHE_MS });
    return 'basic';
  }

  const tier = await getPlanProductTier(sub.plan_id);
  tierCache.set(id, { tier, exp: now + CACHE_MS });
  return tier;
}

async function userHasProFeatures(discordId) {
  const tier = await resolveUserProductTier(discordId);
  return tier === 'pro';
}

const BASIC_DAILY_CALLS_LIMIT = 10;

async function countUserDeskCallsToday(discordId) {
  const sb = getSupabaseServiceRole();
  if (!sb) return 0;
  const dayStart = utcDayStartIso();
  const { count, error } = await sb
    .from('call_performance')
    .select('id', { count: 'exact', head: true })
    .eq('discord_id', String(discordId).trim())
    .eq('source', 'user')
    .gte('call_time', dayStart);
  if (error) return 0;
  return typeof count === 'number' && count >= 0 ? count : 0;
}

/**
 * @returns {{ ok: boolean, reason?: string, tier?: string, usedToday?: number }}
 */
async function assertDeskCallAllowance(discordId) {
  const id = String(discordId || '').trim();
  if (!id) return { ok: false, reason: 'missing_discord_id' };

  const tier = await resolveUserProductTier(id);
  if (tier !== 'pro') {
    return { ok: false, reason: 'pro_required', tier };
  }

  const usedToday = await countUserDeskCallsToday(id);
  return { ok: true, tier, usedToday, unlimited: true };
}

/**
 * Trusted Pro role or staff may attach narrative + images on X desk calls.
 */
async function userMayUseRichXDeskCall(discordId) {
  const id = String(discordId || '').trim();
  if (!id) return false;
  const help = resolveHelpTier(id);
  if (help === 'admin' || help === 'mod') return true;

  const sb = getSupabaseServiceRole();
  if (!sb) return false;
  const { data, error } = await sb
    .from('users')
    .select('trusted_pro')
    .eq('discord_id', id)
    .maybeSingle();
  if (error) return false;
  return data?.trusted_pro === true;
}

module.exports = {
  resolveUserProductTier,
  userHasProFeatures,
  assertDeskCallAllowance,
  userMayUseRichXDeskCall,
  resolveHelpTier,
  BASIC_DAILY_CALLS_LIMIT
};
