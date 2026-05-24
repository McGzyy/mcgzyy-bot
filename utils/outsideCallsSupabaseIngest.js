'use strict';

const { createClient } = require('@supabase/supabase-js');

function getSupabaseServiceRole() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

async function outsideMintHasPrimary(mint) {
  const sb = getSupabaseServiceRole();
  if (!sb) return false;
  const key = String(mint || '').trim();
  if (!key) return false;
  const { data, error } = await sb
    .from('outside_calls')
    .select('id')
    .eq('mint', key)
    .eq('call_role', 'primary')
    .maybeSingle();
  if (error) {
    console.warn('[OutsideCallsIngest] primary lookup failed:', error.message);
    return false;
  }
  return Boolean(data?.id);
}

async function outsideTweetAlreadyStored(tweetId) {
  const sb = getSupabaseServiceRole();
  if (!sb) return false;
  const tid = String(tweetId || '').trim();
  if (!tid) return false;
  const { data, error } = await sb
    .from('outside_calls')
    .select('id')
    .eq('tweet_id', tid)
    .maybeSingle();
  if (error) {
    console.warn('[OutsideCallsIngest] tweet lookup failed:', error.message);
    return false;
  }
  return Boolean(data?.id);
}

/**
 * After FaSol replies in the outside ingest Telegram group, persist a row for the dashboard tape.
 * @param {{ sourceId: string; mint: string; tweetId?: string | null; xPostUrl?: string | null; mint_resolution?: string | null; signal_ticker?: string | null; post_text?: string | null; post_media_urls?: string[] | null }} opts
 */
async function insertOutsideCallRow(opts) {
  const sb = getSupabaseServiceRole();
  if (!sb) {
    return { ok: false, error: 'missing_supabase_service_role' };
  }

  const sourceId = String(opts.sourceId || '').trim();
  const mint = String(opts.mint || '').trim();
  const tweetId = opts.tweetId != null && String(opts.tweetId).trim() ? String(opts.tweetId).trim() : null;
  const xPostUrl = opts.xPostUrl != null && String(opts.xPostUrl).trim() ? String(opts.xPostUrl).trim() : null;
  const mint_resolution =
    opts.mint_resolution != null && String(opts.mint_resolution).trim()
      ? String(opts.mint_resolution).trim().toLowerCase()
      : null;
  const signal_ticker =
    opts.signal_ticker != null && String(opts.signal_ticker).trim()
      ? String(opts.signal_ticker).trim().toUpperCase()
      : null;
  const post_text =
    opts.post_text != null && String(opts.post_text).trim() ? String(opts.post_text).trim().slice(0, 4000) : null;
  const post_media_urls = (() => {
    const raw = opts.post_media_urls;
    if (!Array.isArray(raw)) return [];
    const urls = [];
    for (const u of raw) {
      const s = String(u ?? '').trim();
      if (!s || !/^https?:\/\//i.test(s)) continue;
      if (!urls.includes(s)) urls.push(s);
      if (urls.length >= 4) break;
    }
    return urls;
  })();

  if (!sourceId || !mint) {
    return { ok: false, error: 'missing_source_or_mint' };
  }

  const { data: src, error: srcErr } = await sb
    .from('outside_x_sources')
    .select('id,status')
    .eq('id', sourceId)
    .maybeSingle();

  if (srcErr || !src || src.status !== 'active') {
    return { ok: false, error: 'source_not_active', detail: srcErr?.message };
  }

  const { data: primary, error: primErr } = await sb
    .from('outside_calls')
    .select('id')
    .eq('mint', mint)
    .eq('call_role', 'primary')
    .maybeSingle();

  if (primErr) {
    return { ok: false, error: 'primary_lookup_failed', detail: primErr.message };
  }

  const isEcho = Boolean(primary?.id);
  const row = {
    source_id: sourceId,
    mint,
    call_role: isEcho ? 'echo' : 'primary',
    primary_call_id: isEcho ? primary.id : null,
    tweet_id: tweetId,
    x_post_url: xPostUrl,
    mint_resolution,
    signal_ticker,
    post_text,
    post_media_urls,
    posted_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  const { error: insErr } = await sb.from('outside_calls').insert(row);
  if (insErr) {
    if (insErr.code === '23505') {
      return { ok: false, error: 'duplicate_tweet_or_conflict', detail: insErr.message };
    }
    return { ok: false, error: 'insert_failed', detail: insErr.message };
  }

  return { ok: true, callRole: row.call_role };
}

module.exports = {
  insertOutsideCallRow,
  outsideMintHasPrimary,
  outsideTweetAlreadyStored
};
