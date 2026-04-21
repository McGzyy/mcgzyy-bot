'use strict';

const { createClient } = require('@supabase/supabase-js');
const { getTrackedCall, updateTrackedCallData } = require('./trackedCallsService');

function getSupabaseServiceRole() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

function computeAthMultiple(tracked) {
  const first = Number(
    tracked.firstCalledMarketCap || tracked.latestMarketCap || 0
  );
  const ath = Number(
    tracked.athMc || tracked.ath || tracked.latestMarketCap || first || 0
  );
  if (!(first > 0) || !(ath > 0)) return 1;
  const x = ath / first;
  if (!Number.isFinite(x) || x <= 0) return 1;
  return Number(x.toFixed(4));
}

/** DB `call_performance.call_time` is BIGINT (UTC epoch ms), not timestamptz. */
function callTimeMsFromTracked(tracked) {
  const raw = tracked.firstCalledAt;
  const ms = raw ? new Date(raw).getTime() : Date.now();
  const t = Number.isFinite(ms) ? ms : Date.now();
  return Math.round(t);
}

function callerRoleForDiscordId(discordId) {
  const owner = String(
    process.env.DASHBOARD_OWNER_DISCORD_ID ||
      process.env.OWNER_DISCORD_ID ||
      ''
  ).trim();
  if (owner && owner === String(discordId || '').trim()) return 'owner';
  return 'user';
}

/**
 * Insert a dashboard leaderboard row for a fresh user call (same contract as
 * `call_performance` consumed by mcgbot-dashboard). Requires service role on the bot host.
 *
 * @param {Record<string, unknown>} tracked normalized tracked call
 * @param {{ messageUrl?: string | null }} opts
 * @returns {Promise<{ ok: boolean, skipped?: boolean, id?: string | null, error?: string }>}
 */
async function insertUserCallPerformanceRow(tracked, opts = {}) {
  const sb = getSupabaseServiceRole();
  if (!sb) {
    console.error(
      '[CallPerformanceSync] STATS ROW NOT CREATED: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the bot host (same Supabase project as the dashboard).'
    );
    return { ok: false, skipped: true, reason: 'missing_supabase_service_role' };
  }

  const discordId = String(
    tracked.firstCallerDiscordId || tracked.firstCallerId || ''
  ).trim();
  if (!discordId || discordId.toUpperCase() === 'AUTO_BOT') {
    return { ok: false, skipped: true, reason: 'no_caller_discord_id' };
  }

  const contract = String(tracked.contractAddress || '').trim();
  if (!contract) return { ok: false, skipped: true, reason: 'no_contract' };

  const username = String(
    tracked.firstCallerUsername ||
      tracked.firstCallerPublicName ||
      'Unknown'
  )
    .trim()
    .slice(0, 80);

  const row = {
    discord_id: discordId,
    username: username || 'Unknown',
    ath_multiple: computeAthMultiple(tracked),
    source: 'user',
    call_time: callTimeMsFromTracked(tracked),
    call_ca: contract,
    message_url:
      typeof opts.messageUrl === 'string' && opts.messageUrl.trim()
        ? opts.messageUrl.trim().slice(0, 500)
        : null,
    role: callerRoleForDiscordId(discordId),
    excluded_from_stats: tracked.excludedFromStats === true
  };

  const { data, error } = await sb
    .from('call_performance')
    .insert(row)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[CallPerformanceSync] insert failed:', error.message || error);
    return { ok: false, error: error.message || String(error) };
  }

  const id = data && data.id ? String(data.id) : null;
  if (id) {
    updateTrackedCallData(contract, { callPerformanceId: id });
    return { ok: true, id };
  }

  console.error(
    '[CallPerformanceSync] insert returned no id (check call_performance policies / select after insert)'
  );
  return { ok: false, error: 'insert_missing_id' };
}

/**
 * Push latest ATH multiple to Supabase for mirrored user calls.
 * @param {string} contractAddress
 */
async function updateUserCallPerformanceAth(contractAddress) {
  const sb = getSupabaseServiceRole();
  if (!sb) return;

  const tracked = getTrackedCall(contractAddress);
  if (!tracked || tracked.callSourceType !== 'user_call') return;

  const rowId = tracked.callPerformanceId ? String(tracked.callPerformanceId).trim() : '';
  if (!rowId) return;

  const mult = computeAthMultiple(tracked);
  const { error } = await sb
    .from('call_performance')
    .update({ ath_multiple: mult })
    .eq('id', rowId);

  if (error) {
    console.error(
      '[CallPerformanceSync] update ath failed:',
      contractAddress,
      error.message || error
    );
  }
}

function queueUpdateUserCallPerformanceAth(contractAddress) {
  updateUserCallPerformanceAth(contractAddress).catch(err => {
    console.error('[CallPerformanceSync] async update:', err?.message || err);
  });
}

module.exports = {
  insertUserCallPerformanceRow,
  updateUserCallPerformanceAth,
  queueUpdateUserCallPerformanceAth
};
