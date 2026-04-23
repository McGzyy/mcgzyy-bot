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

/** Current MC / MC at call — drives dashboard "live" X while ATH can still be 1x. */
function computeSpotMultiple(tracked) {
  const first = Number(
    tracked.firstCalledMarketCap || tracked.latestMarketCap || 0
  );
  const cur = Number(
    tracked.latestMarketCap ||
      tracked.firstCalledMarketCap ||
      first ||
      0
  );
  if (!(first > 0) || !(cur > 0)) return 1;
  const x = cur / first;
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

function snapshotMcUsd(tracked) {
  const mcRaw = Number(
    tracked.firstCalledMarketCap || tracked.latestMarketCap || 0
  );
  return Number.isFinite(mcRaw) && mcRaw > 0 ? mcRaw : null;
}

function snapshotImageUrl(tracked) {
  const u = String(tracked.tokenImageUrl || '').trim();
  return u ? u.slice(0, 800) : null;
}

function rowSourceFromTracked(tracked) {
  return tracked.callSourceType === 'bot_call' ? 'bot' : 'user';
}

/** Must match `mcgbot-dashboard/lib/milestoneTrophies.ts` CALL_CLUB_MILESTONE_KEYS + thresholds. */
const CALL_CLUB_MILESTONES = [
  { key: 'call_club_10x', minAth: 10 },
  { key: 'call_club_25x', minAth: 25 },
  { key: 'call_club_50x', minAth: 50 }
];

/**
 * Grant permanent "club" rows when an eligible user call reaches ATH thresholds (once per user per club).
 * @param {string} discordId
 * @param {number} athMultiple
 * @param {string | null} callPerformanceId
 * @param {{ excludedFromStats?: boolean, source?: string }} gates
 */
async function grantCallClubMilestonesIfEligible(
  discordId,
  athMultiple,
  callPerformanceId,
  gates = {}
) {
  const sb = getSupabaseServiceRole();
  if (!sb) return;

  const did = String(discordId || '').trim();
  if (!did || did.toUpperCase() === 'AUTO_BOT') return;

  if (gates.excludedFromStats === true) return;
  if (String(gates.source || 'user').trim() !== 'user') return;

  const m = Number(athMultiple);
  if (!Number.isFinite(m) || m < CALL_CLUB_MILESTONES[0].minAth) return;

  const payloads = [];
  for (const def of CALL_CLUB_MILESTONES) {
    if (m >= def.minAth) {
      payloads.push({
        user_id: did,
        milestone_key: def.key,
        call_performance_id: callPerformanceId || null
      });
    }
  }
  if (!payloads.length) return;

  const { error } = await sb.from('user_milestone_trophies').upsert(payloads, {
    onConflict: 'user_id,milestone_key',
    ignoreDuplicates: true
  });

  if (error) {
    console.error(
      '[CallPerformanceSync] milestone trophies upsert:',
      error.message || error
    );
  }
}

function queueGrantCallClubMilestones(discordId, athMultiple, callPerformanceId, gates) {
  grantCallClubMilestonesIfEligible(
    discordId,
    athMultiple,
    callPerformanceId,
    gates
  ).catch(err => {
    console.error('[CallPerformanceSync] milestone trophies async:', err?.message || err);
  });
}

/**
 * Best-effort: sync `public.users.discord_display_name` / `discord_avatar_url` from the
 * tracked call + optional Discord avatar URL so the web dashboard can show identity without
 * requiring that user to sign in via NextAuth first. PostgREST leaves unspecified columns
 * unchanged on conflict update.
 */
async function upsertUserDiscordIdentityFromTracked(sb, tracked, opts = {}) {
  const discordId = String(
    tracked.firstCallerDiscordId || tracked.firstCallerId || ''
  ).trim();
  if (!discordId || discordId.toUpperCase() === 'AUTO_BOT') return;

  const displayName = String(
    tracked.firstCallerDisplayName ||
      tracked.firstCallerPublicName ||
      tracked.firstCallerUsername ||
      ''
  )
    .trim()
    .slice(0, 100);

  const callerAvatarRaw =
    typeof opts.callerAvatarUrl === 'string'
      ? opts.callerAvatarUrl.trim().slice(0, 800)
      : '';

  const payload = { discord_id: discordId };
  if (displayName) payload.discord_display_name = displayName;
  if (callerAvatarRaw) payload.discord_avatar_url = callerAvatarRaw;

  if (!payload.discord_display_name && !payload.discord_avatar_url) return;

  const { error } = await sb.from('users').upsert(payload, { onConflict: 'discord_id' });
  if (error) {
    console.error(
      '[CallPerformanceSync] users identity upsert:',
      error.message || error
    );
  }
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

  const tokenNameRaw = String(tracked.tokenName || '').trim();
  const tokenTickerRaw = String(tracked.ticker || '').trim();
  const callMc = snapshotMcUsd(tracked);
  const tokenImageUrl = snapshotImageUrl(tracked);

  await upsertUserDiscordIdentityFromTracked(sb, tracked, opts);

  const row = {
    discord_id: discordId,
    username: username || 'Unknown',
    ath_multiple: computeAthMultiple(tracked),
    spot_multiple: computeSpotMultiple(tracked),
    live_market_cap_usd: Number.isFinite(Number(tracked.latestMarketCap))
      ? Number(tracked.latestMarketCap)
      : null,
    source: rowSourceFromTracked(tracked),
    call_time: callTimeMsFromTracked(tracked),
    call_ca: contract,
    token_name: tokenNameRaw ? tokenNameRaw.slice(0, 160) : null,
    token_ticker: tokenTickerRaw ? tokenTickerRaw.slice(0, 48) : null,
    call_market_cap_usd: callMc,
    token_image_url: tokenImageUrl,
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
    queueGrantCallClubMilestones(discordId, Number(row.ath_multiple), id, {
      excludedFromStats: row.excluded_from_stats === true,
      source: row.source
    });
    return { ok: true, id };
  }

  console.error(
    '[CallPerformanceSync] insert returned no id (check call_performance policies / select after insert)'
  );
  return { ok: false, error: 'insert_missing_id' };
}

/**
 * Push latest ATH + token snapshot fields to Supabase for mirrored user calls.
 * @param {string} contractAddress
 */
async function updateUserCallPerformanceAth(contractAddress) {
  const sb = getSupabaseServiceRole();
  if (!sb) {
    console.error(
      '[CallPerformanceSync] update skipped: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY on bot host'
    );
    return;
  }

  const tracked = getTrackedCall(contractAddress);
  if (!tracked || tracked.callSourceType !== 'user_call') return;

  const rowId = tracked.callPerformanceId ? String(tracked.callPerformanceId).trim() : '';
  if (!rowId) {
    console.warn(
      '[CallPerformanceSync] update skipped: tracked call has no callPerformanceId (stats row never linked?)',
      contractAddress
    );
    return;
  }

  const mult = computeAthMultiple(tracked);
  const tokenNameRaw = String(tracked.tokenName || '').trim();
  const tokenTickerRaw = String(tracked.ticker || '').trim();
  const callMc = snapshotMcUsd(tracked);
  const tokenImageUrl = snapshotImageUrl(tracked);

  const liveMc = Number(tracked.latestMarketCap);
  const patch = {
    ath_multiple: mult,
    spot_multiple: computeSpotMultiple(tracked),
    live_market_cap_usd: Number.isFinite(liveMc) && liveMc > 0 ? liveMc : null,
    token_name: tokenNameRaw ? tokenNameRaw.slice(0, 160) : null,
    token_ticker: tokenTickerRaw ? tokenTickerRaw.slice(0, 48) : null,
    call_market_cap_usd: callMc,
    token_image_url: tokenImageUrl
  };

  const { error } = await sb.from('call_performance').update(patch).eq('id', rowId);

  if (error) {
    console.error(
      '[CallPerformanceSync] update row failed:',
      contractAddress,
      error.message || error
    );
    return;
  }

  const callerId = String(
    tracked.firstCallerDiscordId || tracked.firstCallerId || ''
  ).trim();
  queueGrantCallClubMilestones(callerId, mult, rowId, {
    excludedFromStats: tracked.excludedFromStats === true,
    source: 'user'
  });
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
