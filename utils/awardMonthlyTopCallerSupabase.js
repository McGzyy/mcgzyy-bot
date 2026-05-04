'use strict';

const TOP_CALLER_BADGE = 'top_caller';

/**
 * Denormalized profile flag: exactly one user should have `is_top_caller` at a time
 * (current monthly title holder). Best-effort updates on `users` rows that exist.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} newDiscordId
 * @param {string | null | undefined} previousDiscordId
 */
async function syncUsersTopCallerFlags(sb, newDiscordId, previousDiscordId) {
  const next = String(newDiscordId || '').trim();
  if (!sb || !next) return;

  const prev =
    previousDiscordId != null && String(previousDiscordId).trim() !== ''
      ? String(previousDiscordId).trim()
      : '';

  if (prev && prev !== next) {
    const { error } = await sb
      .from('users')
      .update({ is_top_caller: false })
      .eq('discord_id', prev);
    if (error) {
      console.error('[TopCallerAward] users is_top_caller clear prev:', error);
    }
  }

  const { error } = await sb
    .from('users')
    .update({ is_top_caller: true })
    .eq('discord_id', next);
  if (error) {
    console.error('[TopCallerAward] users is_top_caller set winner:', error);
  }
}

/**
 * Record one closed month in `monthly_top_caller_awards` and increment `user_badges`
 * for `top_caller` exactly once per `period_start_ms` (idempotent).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {number} periodStartMs UTC start of that calendar month (ms)
 * @param {string} discordUserId
 * @param {{ previousDiscordId?: string | null }} [opts]
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: unknown }>}
 */
async function awardMonthlyTopCallerIfNewPeriod(sb, periodStartMs, discordUserId, opts = {}) {
  const uid = String(discordUserId || '').trim();
  const period = Number(periodStartMs);
  if (!sb || !uid || !Number.isFinite(period)) {
    return { ok: false, error: new Error('awardMonthlyTopCallerIfNewPeriod: invalid args') };
  }

  const { data: insertedRows, error: insErr } = await sb
    .from('monthly_top_caller_awards')
    .insert({ period_start_ms: period, user_id: uid })
    .select('id');

  if (insErr) {
    const code = String(insErr.code || '');
    const msg = String(insErr.message || '').toLowerCase();
    if (code === '23505' || msg.includes('duplicate') || msg.includes('unique')) {
      return { ok: true, skipped: true };
    }
    console.error('[TopCallerAward] monthly_top_caller_awards insert:', insErr);
    return { ok: false, error: insErr };
  }

  if (!insertedRows || insertedRows.length === 0) {
    return { ok: true, skipped: true };
  }

  const { data: existing, error: selErr } = await sb
    .from('user_badges')
    .select('times_awarded')
    .eq('user_id', uid)
    .eq('badge', TOP_CALLER_BADGE)
    .maybeSingle();

  if (selErr) {
    console.error('[TopCallerAward] user_badges select:', selErr);
    return { ok: false, error: selErr };
  }

  const current =
    existing && typeof existing.times_awarded === 'number' && existing.times_awarded >= 1
      ? existing.times_awarded
      : 0;

  if (current > 0) {
    const { error: upErr } = await sb
      .from('user_badges')
      .update({ times_awarded: current + 1 })
      .eq('user_id', uid)
      .eq('badge', TOP_CALLER_BADGE);
    if (upErr) {
      console.error('[TopCallerAward] user_badges update:', upErr);
      return { ok: false, error: upErr };
    }
  } else {
    const { error: upErr } = await sb.from('user_badges').insert({
      user_id: uid,
      badge: TOP_CALLER_BADGE,
      times_awarded: 1
    });
    if (upErr) {
      console.error('[TopCallerAward] user_badges insert:', upErr);
      return { ok: false, error: upErr };
    }
  }

  await syncUsersTopCallerFlags(sb, uid, opts.previousDiscordId);

  return { ok: true };
}

module.exports = {
  awardMonthlyTopCallerIfNewPeriod,
  syncUsersTopCallerFlags,
  TOP_CALLER_BADGE
};
