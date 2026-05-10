'use strict';

const { createClient } = require('@supabase/supabase-js');

function getSupabaseServiceRole() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * After FaSol replies in the outside ingest Telegram group, persist a row for the dashboard tape.
 * @param {{ sourceId: string; mint: string; tweetId?: string | null; xPostUrl?: string | null }} opts
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

module.exports = { insertOutsideCallRow };
