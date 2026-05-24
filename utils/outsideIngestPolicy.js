'use strict';

const DEFAULT_BLOCK_PHRASES = [
  'scam',
  'stay away',
  'stay out',
  'rug',
  'rug pull',
  'rugpull',
  'honeypot',
  'exit liquidity',
  "don't buy",
  'do not buy',
  'ponzi',
  'dev sold',
  'fake project',
  'serial rug'
];
const DEFAULT_COOLDOWN_MAX = 5;
const DEFAULT_COOLDOWN_MINUTES = 60;

/** @type {{ exp: number; blockPhrases: string[]; cooldownMax: number; cooldownMinutes: number }} */
let policyCache = {
  exp: 0,
  blockPhrases: DEFAULT_BLOCK_PHRASES,
  cooldownMax: DEFAULT_COOLDOWN_MAX,
  cooldownMinutes: DEFAULT_COOLDOWN_MINUTES
};

function normalizeBlockPhrases(raw) {
  if (!Array.isArray(raw)) return [...DEFAULT_BLOCK_PHRASES];
  const out = [];
  for (const item of raw) {
    const s = String(item ?? '')
      .trim()
      .toLowerCase();
    if (!s) continue;
    if (!out.includes(s)) out.push(s);
    if (out.length >= 64) break;
  }
  return out.length > 0 ? out : [...DEFAULT_BLOCK_PHRASES];
}

function clampCooldownMax(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return DEFAULT_COOLDOWN_MAX;
  return Math.min(100, Math.floor(v));
}

function clampCooldownMinutes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1) return DEFAULT_COOLDOWN_MINUTES;
  return Math.min(24 * 60, Math.floor(v));
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient | null} sb
 */
async function loadOutsideIngestPolicy(sb) {
  const now = Date.now();
  if (policyCache.exp > now) return policyCache;

  if (!sb) {
    policyCache = {
      exp: now + 15_000,
      blockPhrases: [...DEFAULT_BLOCK_PHRASES],
      cooldownMax: DEFAULT_COOLDOWN_MAX,
      cooldownMinutes: DEFAULT_COOLDOWN_MINUTES
    };
    return policyCache;
  }

  const { data, error } = await sb
    .from('dashboard_admin_settings')
    .select('outside_block_phrases,outside_source_cooldown_max,outside_source_cooldown_minutes')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (
      msg.includes('outside_block_phrases') ||
      msg.includes('outside_source_cooldown') ||
      error.code === '42703' ||
      error.code === 'PGRST204'
    ) {
      policyCache = {
        exp: now + 15_000,
        blockPhrases: [...DEFAULT_BLOCK_PHRASES],
        cooldownMax: DEFAULT_COOLDOWN_MAX,
        cooldownMinutes: DEFAULT_COOLDOWN_MINUTES
      };
      return policyCache;
    }
    console.warn('[OutsideIngestPolicy] settings read failed:', error.message);
    policyCache = {
      exp: now + 15_000,
      blockPhrases: [...DEFAULT_BLOCK_PHRASES],
      cooldownMax: DEFAULT_COOLDOWN_MAX,
      cooldownMinutes: DEFAULT_COOLDOWN_MINUTES
    };
    return policyCache;
  }

  policyCache = {
    exp: now + 15_000,
    blockPhrases: normalizeBlockPhrases(data?.outside_block_phrases),
    cooldownMax: clampCooldownMax(data?.outside_source_cooldown_max),
    cooldownMinutes: clampCooldownMinutes(data?.outside_source_cooldown_minutes)
  };
  return policyCache;
}

/**
 * @param {string} text
 * @param {string[]} phrases
 */
function tweetTextBlocked(text, phrases) {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  for (const p of phrases) {
    if (p && t.includes(p)) return true;
  }
  return false;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} sourceId
 * @param {number} maxCalls 0 = unlimited
 * @param {number} windowMinutes
 */
async function isSourceOnCooldown(sb, sourceId, maxCalls, windowMinutes) {
  const max = clampCooldownMax(maxCalls);
  if (max <= 0) return false;
  const minutes = clampCooldownMinutes(windowMinutes);
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const sid = String(sourceId || '').trim();
  if (!sid) return false;

  const { count, error } = await sb
    .from('outside_calls')
    .select('id', { count: 'exact', head: true })
    .eq('source_id', sid)
    .gte('posted_at', since);

  if (error) {
    console.warn('[OutsideIngestPolicy] cooldown count failed:', error.message);
    return false;
  }
  return (count ?? 0) >= max;
}

function extractMediaUrlsFromTweet(tweet, includes) {
  const keys = tweet?.attachments?.media_keys;
  if (!Array.isArray(keys) || keys.length === 0) return [];
  const mediaList = includes?.media;
  if (!Array.isArray(mediaList)) return [];
  const byKey = new Map();
  for (const m of mediaList) {
    if (m?.media_key) byKey.set(String(m.media_key), m);
  }
  const urls = [];
  for (const k of keys) {
    const m = byKey.get(String(k));
    if (!m) continue;
    const type = String(m.type || '').toLowerCase();
    if (type === 'photo' && m.url) {
      urls.push(String(m.url));
    } else if (m.preview_image_url) {
      urls.push(String(m.preview_image_url));
    }
    if (urls.length >= 4) break;
  }
  return urls;
}

module.exports = {
  loadOutsideIngestPolicy,
  tweetTextBlocked,
  isSourceOnCooldown,
  extractMediaUrlsFromTweet,
  normalizeBlockPhrases,
  DEFAULT_BLOCK_PHRASES
};
