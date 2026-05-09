'use strict';

const { createClient } = require('@supabase/supabase-js');

function getSupabaseServiceRole() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

function isRowActive(row) {
  if (!row || !row.discord_id) return false;
  if (row.suspended_until == null) return true;
  const t = Date.parse(String(row.suspended_until));
  return Number.isFinite(t) && t > Date.now();
}

/**
 * @param {string} discordId
 * @returns {Promise<boolean>}
 */
async function isDiscordUserCallSuspended(discordId) {
  const id = String(discordId || '').trim();
  if (!id) return false;
  const sb = getSupabaseServiceRole();
  if (!sb) return false;
  try {
    const { data, error } = await sb.from('user_call_suspensions').select('*').eq('discord_id', id).maybeSingle();
    if (error) {
      console.warn('[userCallSuspensionDb]', error.message || error);
      return false;
    }
    if (!data) return false;
    if (!isRowActive(data)) {
      void sb.from('user_call_suspensions').delete().eq('discord_id', id);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[userCallSuspensionDb]', e?.message || e);
    return false;
  }
}

module.exports = { isDiscordUserCallSuspended };
