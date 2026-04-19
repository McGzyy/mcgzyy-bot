'use strict';

const { createClient } = require('@supabase/supabase-js');

function getSupabaseServiceRole() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Upserts `users.x_handle` and `users.x_verified` for the dashboard.
 * Requires SUPABASE_SERVICE_ROLE_KEY on the bot host (same Supabase project as the Next app).
 *
 * @param {string} discordUserId
 * @param {{ xHandle: string, xVerified: boolean }} fields
 */
async function syncUserXFieldsToSupabase(discordUserId, { xHandle, xVerified }) {
  const sb = getSupabaseServiceRole();
  if (!sb) {
    return { ok: false, skipped: true };
  }

  const did = String(discordUserId || '').trim();
  if (!did) return { ok: false, skipped: true };

  const raw = xHandle == null ? '' : String(xHandle);
  const handle = raw.trim().replace(/^@+/, '').replace(/\s+/g, '').slice(0, 32);

  const row = {
    discord_id: did,
    x_handle: handle.length ? handle : null,
    x_verified: Boolean(xVerified)
  };

  const { error } = await sb.from('users').upsert(row, { onConflict: 'discord_id' });
  if (error) {
    console.error('[Supabase/XSync]', error.message || error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

function queueUserXRowSyncToSupabase(discordUserId, fields) {
  syncUserXFieldsToSupabase(discordUserId, fields).catch(err => {
    console.error('[Supabase/XSync] async:', err?.message || err);
  });
}

module.exports = {
  syncUserXFieldsToSupabase,
  queueUserXRowSyncToSupabase
};
