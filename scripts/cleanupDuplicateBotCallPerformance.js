'use strict';

/**
 * One-off / occasional cleanup: remove FaSol-mirror duplicate `call_performance` bot rows
 * when a member `user` row exists for the same CA within a short window.
 *
 * Usage:
 *   node scripts/cleanupDuplicateBotCallPerformance.js              # dry-run (default)
 *   node scripts/cleanupDuplicateBotCallPerformance.js --apply      # delete + merge ATH
 *   node scripts/cleanupDuplicateBotCallPerformance.js --days=60  # scan window
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env (bot host / repo root).
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const DEFAULT_DAYS = 30;
const DEFAULT_PAIR_WINDOW_MS = 2 * 60 * 60 * 1000; // 2h — wider than live dedupe (1h)

function parseArgs(argv) {
  const out = { apply: false, days: DEFAULT_DAYS, windowMs: DEFAULT_PAIR_WINDOW_MS };
  for (const a of argv) {
    if (a === '--apply') out.apply = true;
    else if (a.startsWith('--days=')) {
      const n = Number(a.slice('--days='.length));
      if (Number.isFinite(n) && n > 0) out.days = Math.floor(n);
    } else if (a.startsWith('--window-ms=')) {
      const n = Number(a.slice('--window-ms='.length));
      if (Number.isFinite(n) && n > 0) out.windowMs = Math.floor(n);
    }
  }
  return out;
}

function getServiceSupabase() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  }
  return createClient(url, key);
}

function rowTimeMs(row) {
  const t = row.call_time;
  if (typeof t === 'number' && Number.isFinite(t)) return t;
  if (typeof t === 'string') {
    const p = Date.parse(t);
    if (Number.isFinite(p)) return p;
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function normCa(ca) {
  return String(ca || '').trim();
}

function normSource(s) {
  const v = String(s || '').trim().toLowerCase();
  return v === 'bot' ? 'bot' : 'user';
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function fetchRows(sb, sinceMs) {
  const pageSize = 1000;
  const all = [];
  let from = 0;

  while (true) {
    const { data, error } = await sb
      .from('call_performance')
      .select(
        'id, call_ca, source, call_time, discord_id, username, ath_multiple, spot_multiple, message_url, excluded_from_stats, hidden_from_dashboard'
      )
      .gte('call_time', sinceMs)
      .order('call_time', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const batch = Array.isArray(data) ? data : [];
    all.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {number} windowMs
 */
function planDuplicateBotRemovals(rows, windowMs) {
  const byCa = new Map();

  for (const row of rows) {
    const ca = normCa(row.call_ca);
    if (!ca) continue;
    const key = ca.toLowerCase();
    if (!byCa.has(key)) byCa.set(key, { ca, rows: [] });
    byCa.get(key).rows.push(row);
  }

  /** @type {Array<{ bot: Record<string, unknown>, user: Record<string, unknown>, deltaMs: number }>} */
  const pairs = [];

  for (const { rows: group } of byCa.values()) {
    const users = group.filter((r) => normSource(r.source) === 'user');
    const bots = group.filter((r) => normSource(r.source) === 'bot');
    if (users.length === 0 || bots.length === 0) continue;

    for (const bot of bots) {
      const bt = rowTimeMs(bot);
      let bestUser = null;
      let bestDelta = Infinity;

      for (const user of users) {
        const ut = rowTimeMs(user);
        const delta = Math.abs(bt - ut);
        if (delta <= windowMs && delta < bestDelta) {
          bestDelta = delta;
          bestUser = user;
        }
      }

      if (bestUser) {
        pairs.push({ bot, user: bestUser, deltaMs: bestDelta });
      }
    }
  }

  // If multiple bots matched same user+CA, keep unique bot ids only
  const seenBot = new Set();
  return pairs.filter((p) => {
    const id = String(p.bot.id);
    if (seenBot.has(id)) return false;
    seenBot.add(id);
    return true;
  });
}

async function repointTrophies(sb, fromId, toId) {
  const { data, error } = await sb
    .from('user_milestone_trophies')
    .select('id')
    .eq('call_performance_id', fromId);
  if (error) {
    console.warn('[cleanup] trophy lookup:', error.message);
    return 0;
  }
  const ids = (data || []).map((r) => r.id).filter(Boolean);
  if (ids.length === 0) return 0;

  const { error: upErr } = await sb
    .from('user_milestone_trophies')
    .update({ call_performance_id: toId })
    .eq('call_performance_id', fromId);
  if (upErr) {
    console.warn('[cleanup] trophy repoint:', upErr.message);
    return 0;
  }
  return ids.length;
}

async function applyPlan(sb, pairs) {
  let deleted = 0;
  let merged = 0;
  let trophies = 0;

  for (const { bot, user } of pairs) {
    const botId = String(bot.id);
    const userId = String(user.id);
    const nextAth = Math.max(num(user.ath_multiple), num(bot.ath_multiple), 1);
    const nextSpot = Math.max(num(user.spot_multiple), num(bot.spot_multiple), 0);

    if (nextAth > num(user.ath_multiple) || nextSpot > num(user.spot_multiple)) {
      const patch = {};
      if (nextAth > num(user.ath_multiple)) patch.ath_multiple = nextAth;
      if (nextSpot > num(user.spot_multiple)) patch.spot_multiple = nextSpot;
      const { error: mergeErr } = await sb.from('call_performance').update(patch).eq('id', userId);
      if (mergeErr) {
        console.error(`[cleanup] merge ATH user ${userId}:`, mergeErr.message);
        continue;
      }
      merged += 1;
    }

    trophies += await repointTrophies(sb, botId, userId);

    const { error: delErr } = await sb.from('call_performance').delete().eq('id', botId);
    if (delErr) {
      console.error(`[cleanup] delete bot ${botId}:`, delErr.message);
      continue;
    }
    deleted += 1;
  }

  return { deleted, merged, trophies };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sb = getServiceSupabase();
  const sinceMs = Date.now() - args.days * 24 * 60 * 60 * 1000;

  console.log(
    `[cleanup] Scanning call_performance since ${new Date(sinceMs).toISOString()} (${args.days}d), pair window ${args.windowMs}ms, mode=${args.apply ? 'APPLY' : 'dry-run'}`
  );

  const rows = await fetchRows(sb, sinceMs);
  console.log(`[cleanup] Loaded ${rows.length} row(s).`);

  const pairs = planDuplicateBotRemovals(rows, args.windowMs);
  if (pairs.length === 0) {
    console.log('[cleanup] No bot/user duplicate pairs found.');
    return;
  }

  console.log(`[cleanup] Found ${pairs.length} bot row(s) to remove (member row kept):\n`);
  for (const { bot, user, deltaMs } of pairs) {
    const ca = normCa(bot.call_ca);
    const short = ca.length > 12 ? `${ca.slice(0, 6)}…${ca.slice(-4)}` : ca;
    console.log(
      `  bot ${bot.id} (${bot.username || '?'}) → delete | keep user ${user.id} (${user.username || '?'}) | ${short} | Δ${Math.round(deltaMs / 1000)}s`
    );
  }

  if (!args.apply) {
    console.log('\n[cleanup] Dry-run only. Re-run with --apply to merge ATH (if higher on bot row) and delete bot duplicates.');
    return;
  }

  const result = await applyPlan(sb, pairs);
  console.log(
    `\n[cleanup] Done. Deleted ${result.deleted} bot row(s), merged ATH on ${result.merged} user row(s), repointed ${result.trophies} trophy row(s).`
  );
}

main().catch((e) => {
  console.error('[cleanup] Fatal:', e?.message || e);
  process.exit(1);
});
