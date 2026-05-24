'use strict';

/**
 * Polls X for new posts from `outside_x_sources` (status=active), extracts a Solana mint (or resolves $TICKER
 * via `outsideTickerResolve.js`), then `requestFaSolEnrichmentOutside` → Telegram outside group → FaSol reply →
 * `outside_calls` insert.
 *
 * Runs in the **Discord bot Node process** (same host as `startTelegramFaSolMirror` long-poll).
 * Setting env only on Vercel does **not** start this; the bot needs the env vars below.
 *
 * Env:
 *   OUTSIDE_X_CALLS_POLL_DISABLED — set to 1 to turn off (default: poll when deps exist)
 *   OUTSIDE_X_CALLS_LEAN_MODE — set to 0 to use legacy 45s cadence (default: lean on → 90s)
 *   OUTSIDE_X_CALLS_POLL_INTERVAL_MS — override interval (lean clamp 30s–5m; legacy 15s–2m)
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET (same as xPoster)
 *   OUTSIDE_TICKER_DEX_SEARCH_DISABLED — set to 1 to only use curated $TICKER map (no Dexscreener search)
 *   OUTSIDE_TICKER_MIN_LIQ_USD — min pair liquidity for dex_search (default 25000)
 */

const { createClient } = require('@supabase/supabase-js');
const { oauth1aGet } = require('./xPoster');
const { requestFaSolEnrichmentOutside } = require('./telegramFaSolMirror');
const { resolveTickerToMintSolana } = require('./outsideTickerResolve');

const X_API_BASE = 'https://api.x.com/2';

const MINT_RE = /\b([1-9A-HJ-NP-Za-km-z]{32,44})(?:pump)?\b/i;

function truthyEnv(v) {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function getSupabaseServiceRole() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

function getFaSolOutsideIngestChatIdRaw() {
  return String(process.env.TELEGRAM_FASOL_OUTSIDE_CHAT_ID ?? '').trim();
}

/** Default on: ~90s between full passes — fewer X timeline reads until Pro revenue covers credits. */
const LEAN_POLL_INTERVAL_MS = 90_000;
const LEGACY_POLL_INTERVAL_MS = 45_000;
const LEAN_POLL_MIN_MS = 30_000;
const LEAN_POLL_MAX_MS = 300_000;
const LEGACY_POLL_MIN_MS = 15_000;
const LEGACY_POLL_MAX_MS = 120_000;

function pollDisabled() {
  return truthyEnv(process.env.OUTSIDE_X_CALLS_POLL_DISABLED);
}

function falsyEnv(v) {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return s === '0' || s === 'false' || s === 'no' || s === 'off';
}

/** Lean mode is the product default; set OUTSIDE_X_CALLS_LEAN_MODE=0 for legacy 45s polling. */
function isLeanMode() {
  return !falsyEnv(process.env.OUTSIDE_X_CALLS_LEAN_MODE);
}

function hasXReadCreds() {
  return Boolean(
    String(process.env.X_API_KEY || '').trim() &&
      String(process.env.X_API_SECRET || '').trim() &&
      String(process.env.X_ACCESS_TOKEN || '').trim() &&
      String(process.env.X_ACCESS_TOKEN_SECRET || '').trim()
  );
}

function hasTelegramBotToken() {
  return Boolean(String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim());
}

function shouldStartPoller() {
  if (pollDisabled()) return false;
  if (!getFaSolOutsideIngestChatIdRaw()) return false;
  if (!hasTelegramBotToken()) return false;
  if (!getSupabaseServiceRole()) return false;
  if (!hasXReadCreds()) return false;
  return true;
}

/** Set when `startOutsideXCallerPoller()` installed its interval (cleared on stop callback). */
let outsidePollIntervalActive = false;

/** Cached `dashboard_admin_settings.outside_calls_enabled` (15s TTL). */
let dashboardProductEnabledCache = { exp: 0, enabled: true, checked: false };

function envProductForceOff() {
  const s = String(process.env.OUTSIDE_CALLS_FEATURE_DISABLED ?? '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/**
 * When false, skip X timeline reads (admin "coming soon" or env kill switch).
 * Defaults true if settings row/column missing.
 */
async function isOutsideCallsProductEnabled() {
  if (envProductForceOff()) return false;

  const now = Date.now();
  if (dashboardProductEnabledCache.exp > now) {
    return dashboardProductEnabledCache.enabled;
  }

  const sb = getSupabaseServiceRole();
  if (!sb) {
    dashboardProductEnabledCache = { exp: now + 15_000, enabled: true, checked: true };
    return true;
  }

  const { data, error } = await sb
    .from('dashboard_admin_settings')
    .select('outside_calls_enabled')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('outside_calls_enabled') || error.code === '42703' || error.code === 'PGRST204') {
      dashboardProductEnabledCache = { exp: now + 15_000, enabled: true, checked: true };
      return true;
    }
    console.warn('[OutsideXPoll] dashboard_admin_settings read failed:', error.message);
    dashboardProductEnabledCache = { exp: now + 15_000, enabled: true, checked: true };
    return true;
  }

  const enabled = data == null ? true : data.outside_calls_enabled !== false;
  dashboardProductEnabledCache = { exp: now + 15_000, enabled, checked: true };
  return enabled;
}

function resolvePollIntervalMs() {
  const lean = isLeanMode();
  const minMs = lean ? LEAN_POLL_MIN_MS : LEGACY_POLL_MIN_MS;
  const maxMs = lean ? LEAN_POLL_MAX_MS : LEGACY_POLL_MAX_MS;
  const envRaw = String(process.env.OUTSIDE_X_CALLS_POLL_INTERVAL_MS ?? '').trim();
  const defaultMs = lean ? LEAN_POLL_INTERVAL_MS : LEGACY_POLL_INTERVAL_MS;
  const parsed = envRaw ? Number(envRaw) : defaultMs;
  const n = Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs;
  return Math.max(minMs, Math.min(maxMs, Math.floor(n)));
}

/**
 * Missing env on the bot host (empty when disabled-by-env or fully configured).
 * @returns {string[]}
 */
function getOutsideXPollBlockers() {
  if (pollDisabled()) return [];
  const blockers = [];
  if (!hasTelegramBotToken()) blockers.push('TELEGRAM_BOT_TOKEN');
  if (!getFaSolOutsideIngestChatIdRaw()) blockers.push('TELEGRAM_FASOL_OUTSIDE_CHAT_ID');
  if (!getSupabaseServiceRole()) blockers.push('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY');
  if (!hasXReadCreds()) blockers.push('X_API_KEY + X_ACCESS_TOKEN (+ secrets)');
  return blockers;
}

/**
 * Snapshot for GET /health and admin dashboard (bot process env only).
 * @returns {{
 *   status: 'disabled' | 'running' | 'idle',
 *   disabledByEnv: boolean,
 *   readyToRun: boolean,
 *   running: boolean,
 *   pollIntervalMs: number,
 *   leanMode: boolean,
 *   disabledByDashboard: boolean,
 *   blockers: string[],
 *   hint: string
 * }}
 */
function getOutsideXPollStatus() {
  const disabledByEnv = pollDisabled();
  const disabledByDashboard =
    dashboardProductEnabledCache.checked && dashboardProductEnabledCache.enabled === false;
  const blockers = getOutsideXPollBlockers();
  const readyToRun = !disabledByEnv && blockers.length === 0;
  const pollIntervalMs = resolvePollIntervalMs();
  const leanMode = isLeanMode();
  const running = Boolean(
    outsidePollIntervalActive && readyToRun && !disabledByDashboard && !envProductForceOff()
  );
  const intervalSec = Math.round(pollIntervalMs / 1000);
  const leanNote = leanMode
    ? `Lean mode (~${intervalSec}s) — fewer X reads; CAs may appear ~30s–2m after post.`
    : `Legacy cadence (~${intervalSec}s).`;

  if (disabledByEnv) {
    return {
      status: 'disabled',
      disabledByEnv: true,
      readyToRun: false,
      running: false,
      pollIntervalMs,
      leanMode,
      disabledByDashboard: false,
      blockers: [],
      hint:
        'OUTSIDE_X_CALLS_POLL_DISABLED is set on the bot host. X timeline reads are off; milestone and D/W/M posts still use X write credits when enabled.'
    };
  }

  if (disabledByDashboard || envProductForceOff()) {
    return {
      status: 'disabled',
      disabledByEnv: false,
      readyToRun,
      running: false,
      pollIntervalMs,
      leanMode,
      disabledByDashboard: true,
      blockers: [],
      hint:
        'Outside Calls is off in dashboard admin (coming soon). Pro tape hidden; X polling paused. Turn on under Admin → Outside X monitors.'
    };
  }

  if (running) {
    return {
      status: 'running',
      disabledByEnv: false,
      readyToRun: true,
      running: true,
      pollIntervalMs,
      leanMode,
      disabledByDashboard: false,
      blockers: [],
      hint: `Polling active monitors every ${intervalSec}s (X API read credits). ${leanNote}`
    };
  }

  if (readyToRun) {
    return {
      status: 'idle',
      disabledByEnv: false,
      readyToRun: true,
      running: false,
      pollIntervalMs,
      leanMode,
      disabledByDashboard: false,
      blockers: [],
      hint: 'Env is configured but the poller is not running — restart the Discord bot (index.js) on the bot host.'
    };
  }

  return {
    status: 'idle',
    disabledByEnv: false,
    readyToRun: false,
    running: false,
    pollIntervalMs,
    leanMode,
    disabledByDashboard: false,
    blockers,
    hint:
      blockers.length > 0
        ? `Missing on bot host: ${blockers.join('; ')}.`
        : 'Outside X poll is idle.'
  };
}

function extractFirstMintFromText(text) {
  const m = String(text || '').match(MINT_RE);
  return m && m[1] ? String(m[1]).trim() : '';
}

function isRetweetPayload(tweet) {
  const ref = tweet?.referenced_tweets;
  if (!Array.isArray(ref)) return false;
  return ref.some((r) => r && String(r.type || '').toLowerCase() === 'retweeted');
}

function compareTweetIdAsc(a, b) {
  try {
    const ba = BigInt(String(a));
    const bb = BigInt(String(b));
    if (ba < bb) return -1;
    if (ba > bb) return 1;
    return 0;
  } catch {
    return 0;
  }
}

function maxTweetId(ids) {
  let best = '';
  for (const id of ids) {
    if (!id) continue;
    if (!best || compareTweetIdAsc(best, id) < 0) best = String(id);
  }
  return best || null;
}

/** @type {Map<string, { id: string, exp: number }>} */
const userIdCache = new Map();
const USER_ID_CACHE_MS = 6 * 60 * 60 * 1000;

async function resolveTwitterUserId(handleNormalized) {
  const key = String(handleNormalized || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
  if (!key) return null;

  const hit = userIdCache.get(key);
  if (hit && hit.exp > Date.now()) {
    return hit.id;
  }

  const url = `${X_API_BASE}/users/by/username/${encodeURIComponent(key)}`;
  try {
    const res = await oauth1aGet(url, { 'user.fields': 'id,username' });
    const id = res?.data?.data?.id != null ? String(res.data.data.id) : '';
    if (!id) {
      console.warn(`[OutsideXPoll] No X user id for @${key}`);
      return null;
    }
    userIdCache.set(key, { id, exp: Date.now() + USER_ID_CACHE_MS });
    return id;
  } catch (e) {
    const st = e?.response?.status;
    const body = e?.response?.data;
    if (st === 402) {
      console.error(
        '[OutsideXPoll] X API credits depleted (402 CreditsDepleted). Outside polling cannot resolve handles until credits are restored on the X developer account.'
      );
    } else {
      console.error(`[OutsideXPoll] users/by/username @${key} failed`, st, body || e?.message || e);
    }
    return null;
  }
}

/**
 * @param {string} userId
 * @param {string | null} sinceTweetId
 * @returns {Promise<{ ok: boolean, tweets: Array<{ id: string, text: string }>, error?: string, httpStatus?: number }>}
 */
async function fetchUserTweetsSince(userId, sinceTweetId) {
  const baseUrl = `${X_API_BASE}/users/${encodeURIComponent(userId)}/tweets`;
  const query = {
    max_results: '10',
    'tweet.fields': 'id,text,created_at,referenced_tweets',
    exclude: 'retweets'
  };
  if (sinceTweetId && String(sinceTweetId).trim()) {
    query.since_id = String(sinceTweetId).trim();
  }

  try {
    const res = await oauth1aGet(baseUrl, query);
    const rows = Array.isArray(res?.data?.data) ? res.data.data : [];
    const tweets = [];
    for (const row of rows) {
      const id = row?.id != null ? String(row.id) : '';
      const text = row?.text != null ? String(row.text) : '';
      if (!id) continue;
      if (isRetweetPayload(row)) continue;
      tweets.push({ id, text, raw: row });
    }
    return { ok: true, tweets };
  } catch (e) {
    const httpStatus = e?.response?.status;
    return {
      ok: false,
      tweets: [],
      error: e?.response?.data || e?.message || String(e),
      httpStatus
    };
  }
}

async function updateSourcePollCursor(sourceId, tweetId) {
  const sb = getSupabaseServiceRole();
  if (!sb) return { ok: false };
  const { error } = await sb
    .from('outside_x_sources')
    .update({ outside_poll_since_tweet_id: String(tweetId), updated_at: new Date().toISOString() })
    .eq('id', sourceId);
  if (error) {
    console.error('[OutsideXPoll] cursor update failed:', error.message);
    return { ok: false };
  }
  return { ok: true };
}

async function pollOneSource(row) {
  const sourceId = String(row.id || '').trim();
  const handle = String(row.x_handle_normalized || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
  const sinceStored = row.outside_poll_since_tweet_id != null ? String(row.outside_poll_since_tweet_id).trim() : '';

  if (!sourceId || !handle) return;

  const userId = await resolveTwitterUserId(handle);
  if (!userId) return;

  const fetchRes = await fetchUserTweetsSince(userId, sinceStored || null);
  if (!fetchRes.ok) {
    console.error('[OutsideXPoll] tweets fetch failed:', handle, fetchRes.httpStatus, fetchRes.error);
    return;
  }

  const tweets = fetchRes.tweets;
  if (tweets.length === 0) {
    return;
  }

  if (!sinceStored) {
    const mx = maxTweetId(tweets.map((t) => t.id));
    if (mx) {
      await updateSourcePollCursor(sourceId, mx);
      console.log(
        `[OutsideXPoll] Primed @${handle} — set cursor to newest tweet (no backlog). Next posts will ingest.`
      );
    }
    return;
  }

  tweets.sort((a, b) => compareTweetIdAsc(a.id, b.id));

  for (const tw of tweets) {
    const xUrl = `https://x.com/${handle}/status/${tw.id}`;
    let mint = extractFirstMintFromText(tw.text);
    let mintResolution = 'ca_in_post';
    let signalTicker = null;

    if (!mint) {
      const tick = await resolveTickerToMintSolana(tw.text);
      if (tick && tick.mint) {
        mint = tick.mint;
        mintResolution = tick.resolution;
        signalTicker = tick.tickerNormalized;
      }
    }

    if (!mint) {
      await updateSourcePollCursor(sourceId, tw.id);
      continue;
    }

    try {
      console.log(
        `[OutsideXPoll] @${handle} tweet ${tw.id} → mint ${mint.slice(0, 8)}…` +
          (signalTicker ? ` ($${signalTicker} via ${mintResolution})` : '') +
          ' → FaSol outside ingest'
      );
      await requestFaSolEnrichmentOutside(mint, {
        sourceId,
        tweetId: tw.id,
        xPostUrl: xUrl,
        timeoutMs: Number(process.env.TELEGRAM_FASOL_ENRICH_TIMEOUT_MS || 28_000),
        mintResolution,
        signalTicker
      });
    } catch (e) {
      const msg = e?.message || String(e);
      console.error(`[OutsideXPoll] FaSol/outside pipeline failed @${handle} ${tw.id}:`, msg);
      return;
    }

    await updateSourcePollCursor(sourceId, tw.id);
  }
}

async function pollAllSourcesOnce() {
  const sb = getSupabaseServiceRole();
  if (!sb) return;

  const { data, error } = await sb
    .from('outside_x_sources')
    .select('id,x_handle_normalized,outside_poll_since_tweet_id')
    .eq('status', 'active');

  if (error) {
    console.error('[OutsideXPoll] load sources failed:', error.message);
    return;
  }

  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) {
    return;
  }

  for (const row of rows) {
    try {
      await pollOneSource(row);
    } catch (e) {
      console.error('[OutsideXPoll] source error:', row?.x_handle_normalized, e?.message || e);
    }
  }
}

/**
 * @returns {null | (() => void)}
 */
function startOutsideXCallerPoller() {
  outsidePollIntervalActive = false;
  if (!shouldStartPoller()) {
    console.log(
      '[OutsideXPoll] Idle — need TELEGRAM_BOT_TOKEN + TELEGRAM_FASOL_OUTSIDE_CHAT_ID + Supabase service role + X creds; ' +
        'set OUTSIDE_X_CALLS_POLL_DISABLED=1 to suppress.'
    );
    return null;
  }

  const intervalMs = resolvePollIntervalMs();

  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await pollAllSourcesOnce();
    } finally {
      busy = false;
    }
  };

  void tick();
  void isOutsideCallsProductEnabled().catch(() => {});
  const id = setInterval(() => {
    void tick();
  }, intervalMs);

  outsidePollIntervalActive = true;
  const modeLabel = isLeanMode() ? 'lean' : 'legacy';
  console.log(
    `[OutsideXPoll] Started (${modeLabel}, every ${intervalMs}ms) — active outside_x_sources → X (mint or $ticker) → FaSol → outside_calls`
  );

  return () => {
    outsidePollIntervalActive = false;
    clearInterval(id);
  };
}

module.exports = {
  startOutsideXCallerPoller,
  pollAllSourcesOnce,
  getOutsideXPollStatus
};
