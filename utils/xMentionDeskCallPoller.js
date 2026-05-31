'use strict';

/**
 * Poll @McGBot mentions on X → desk calls (Pro). Trusted Pro / staff may attach narrative + images.
 *
 * Env:
 *   X_MENTION_DESK_CALLS_ENABLED — default on when X creds exist; set 0 to disable
 *   X_MENTION_DESK_POLL_INTERVAL_MS — default 60s (min 30s, max 5m)
 *   X_MENTION_DESK_POST_REPLIES — default 1; set 0 to skip public X replies
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { oauth1aGet, createPost, fetchXAuthenticatedUser, getXBotUsernameForCopy } = require('./xPoster');
const { parseMentionDeskCallTweet } = require('./xMentionDeskCallParse');
const {
  assertDeskCallAllowance,
  userMayUseRichXDeskCall
} = require('./productTierAccess');
const { handleCallFromDashboard } = require('../commands/basicCommands');
const { isDiscordUserCallSuspended } = require('./userCallSuspensionDb');

const X_API_BASE = 'https://api.x.com/2';
const STATE_PATH = path.join(__dirname, '..', 'data', 'xMentionDeskPollState.json');
const DEFAULT_POLL_MS = 60_000;

let pollIntervalActive = false;
let cachedBotUserId = null;

function truthyEnv(v) {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function falsyEnv(v) {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return s === '0' || s === 'false' || s === 'no' || s === 'off';
}

function mentionDeskEnabled() {
  if (falsyEnv(process.env.X_MENTION_DESK_CALLS_ENABLED)) return false;
  return Boolean(
    process.env.X_API_KEY &&
      process.env.X_API_SECRET &&
      process.env.X_ACCESS_TOKEN &&
      process.env.X_ACCESS_TOKEN_SECRET
  );
}

function postRepliesEnabled() {
  return !falsyEnv(process.env.X_MENTION_DESK_POST_REPLIES ?? '1');
}

function resolvePollIntervalMs() {
  const raw = Number(process.env.X_MENTION_DESK_POLL_INTERVAL_MS ?? DEFAULT_POLL_MS);
  const n = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_POLL_MS;
  return Math.max(30_000, Math.min(300_000, Math.floor(n)));
}

function getSupabaseServiceRole() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    const j = JSON.parse(raw);
    return {
      sinceTweetId: j?.sinceTweetId != null ? String(j.sinceTweetId).trim() : '',
      primed: j?.primed === true
    };
  } catch {
    return { sinceTweetId: '', primed: false };
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(
      STATE_PATH,
      JSON.stringify(
        {
          sinceTweetId: state.sinceTweetId || '',
          primed: state.primed === true,
          updatedAt: new Date().toISOString()
        },
        null,
        2
      ),
      'utf8'
    );
  } catch (e) {
    console.warn('[XMentionDesk] state save failed:', e?.message || e);
  }
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
  return best || '';
}

async function fetchBotUserId() {
  if (cachedBotUserId) return cachedBotUserId;
  const me = await fetchXAuthenticatedUser();
  if (me?.id) {
    cachedBotUserId = String(me.id);
    return cachedBotUserId;
  }
  return null;
}

/**
 * @param {string} userId
 * @param {string | null} sinceTweetId
 */
async function fetchMentionsSince(userId, sinceTweetId) {
  const baseUrl = `${X_API_BASE}/users/${encodeURIComponent(userId)}/mentions`;
  const query = {
    max_results: '10',
    'tweet.fields': 'id,text,created_at,author_id,attachments,referenced_tweets',
    expansions: 'attachments.media_keys,author_id',
    'media.fields': 'url,preview_image_url,type',
    'user.fields': 'username'
  };
  if (sinceTweetId && String(sinceTweetId).trim()) {
    query.since_id = String(sinceTweetId).trim();
  }

  try {
    const res = await oauth1aGet(baseUrl, query);
    const rows = Array.isArray(res?.data?.data) ? res.data.data : [];
    const includes = res?.data?.includes;
    const tweets = [];
    for (const row of rows) {
      const id = row?.id != null ? String(row.id) : '';
      const text = row?.text != null ? String(row.text) : '';
      if (!id) continue;
      const refs = row?.referenced_tweets;
      if (Array.isArray(refs) && refs.some(r => String(r?.type || '').toLowerCase() === 'retweeted')) {
        continue;
      }
      tweets.push({ id, text, raw: row, authorId: row?.author_id != null ? String(row.author_id) : '' });
    }
    return { ok: true, tweets, includes };
  } catch (e) {
    const httpStatus = e?.response?.status;
    return {
      ok: false,
      tweets: [],
      includes: null,
      httpStatus,
      error: e?.response?.data || e?.message || String(e)
    };
  }
}

async function lookupDiscordByXUsername(xUsername) {
  const sb = getSupabaseServiceRole();
  if (!sb) return null;
  const handle = String(xUsername || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
  if (!handle) return null;

  const { data, error } = await sb
    .from('users')
    .select('discord_id,x_handle,x_verified,trusted_pro')
    .ilike('x_handle', handle)
    .eq('x_verified', true)
    .limit(3);

  if (error) {
    console.warn('[XMentionDesk] users lookup failed:', error.message);
    return null;
  }

  const rows = Array.isArray(data) ? data : [];
  const exact = rows.find(
    r =>
      String(r?.x_handle || '')
        .trim()
        .replace(/^@+/, '')
        .toLowerCase() === handle
  );
  const pick = exact || rows[0];
  if (!pick?.discord_id) return null;
  return {
    discordId: String(pick.discord_id).trim(),
    xHandle: handle,
    trustedPro: pick.trusted_pro === true
  };
}

async function xTweetAlreadyLogged(tweetId) {
  const sb = getSupabaseServiceRole();
  if (!sb) return false;
  const tid = String(tweetId || '').trim();
  if (!tid) return false;
  const { data, error } = await sb
    .from('call_performance')
    .select('id')
    .eq('source_x_tweet_id', tid)
    .maybeSingle();
  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('source_x_tweet_id') || error.code === '42703') return false;
    return false;
  }
  return Boolean(data?.id);
}

async function replyOnX(inReplyToTweetId, text) {
  if (!postRepliesEnabled()) return;
  const tid = String(inReplyToTweetId || '').trim();
  const body = String(text || '').trim().slice(0, 270);
  if (!tid || !body) return;
  try {
    await createPost(body, tid, null, {
      audit: { category: 'x_mention_desk_reply', callSourceType: 'user_call' }
    });
  } catch (e) {
    console.warn('[XMentionDesk] reply failed:', e?.message || e);
  }
}

function dashboardUrl() {
  const raw = String(process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'https://mcgbot.xyz').trim();
  return raw.replace(/\/$/, '');
}

/**
 * @param {import('discord.js').Client} discordClient
 * @param {object} tweet
 * @param {object} includes
 * @param {Map<string, { username?: string }>} usersById
 */
async function processOneMention(discordClient, tweet, includes, usersById) {
  const tweetId = String(tweet.id || '').trim();
  if (!tweetId) return;

  if (await xTweetAlreadyLogged(tweetId)) {
    return;
  }

  const authorId = String(tweet.authorId || '').trim();
  const author =
    usersById.get(authorId) ||
    (includes?.users || []).find(u => String(u?.id) === authorId);
  const authorUsername = author?.username ? String(author.username) : '';

  if (!authorUsername) {
    console.log(`[XMentionDesk] Skip tweet ${tweetId} — no author username`);
    return;
  }

  const linked = await lookupDiscordByXUsername(authorUsername);
  if (!linked) {
    await replyOnX(
      tweetId,
      `Link your X account on ${dashboardUrl()} (Settings → Connect X), then tag @${getXBotUsernameForCopy()} with a Solana CA to log a desk call.`
    );
    return;
  }

  if (await isDiscordUserCallSuspended(linked.discordId)) {
    await replyOnX(tweetId, 'Your desk call access is suspended. Contact a moderator if this is a mistake.');
    return;
  }

  const allowance = await assertDeskCallAllowance(linked.discordId);
  if (!allowance.ok) {
    if (allowance.reason === 'pro_required') {
      await replyOnX(
        tweetId,
        `X desk calls are a Pro feature. Upgrade at ${dashboardUrl()}/membership — then tag @${getXBotUsernameForCopy()} with a Solana CA.`
      );
    } else {
      await replyOnX(tweetId, `Could not log this call (${allowance.reason || 'not_allowed'}).`);
    }
    return;
  }

  const allowRich = (await userMayUseRichXDeskCall(linked.discordId)) || linked.trustedPro;
  const parsed = parseMentionDeskCallTweet(tweet, includes, { allowNarrative: allowRich });

  if (!parsed.hasMint) {
    await replyOnX(
      tweetId,
      `Include a Solana contract address in your post. Pro members: tag @${getXBotUsernameForCopy()} + CA to log a desk call.`
    );
    return;
  }

  const xPostUrl = `https://x.com/${authorUsername}/status/${tweetId}`;
  const webhookUrl = String(process.env.DISCORD_USER_CALLS_WEBHOOK_URL || '').trim();

  try {
    await handleCallFromDashboard(discordClient, {
      userId: linked.discordId,
      contractAddress: parsed.mint,
      webhookUrl: webhookUrl || null,
      source: 'x_mention',
      messageExtras: {
        callNarrative: parsed.narrative,
        callMediaUrls: parsed.mediaUrls,
        sourceXTweetId: tweetId,
        xPostUrl
      }
    });

    const richNote =
      allowRich && parsed.narrative
        ? ' Thesis saved on your desk call.'
        : allowRich
          ? ''
          : '';
    await replyOnX(
      tweetId,
      `Logged on the McGBot desk.${richNote} ${dashboardUrl()}`
    );
    console.log(
      `[XMentionDesk] Logged @${authorUsername} tweet ${tweetId} mint ${parsed.mint.slice(0, 8)}…` +
        (parsed.narrative ? ' (narrative)' : '')
    );
  } catch (e) {
    const msg = e?.message || String(e);
    console.error(`[XMentionDesk] call failed @${authorUsername} ${tweetId}:`, msg);
    if (/already|duplicate|recent/i.test(msg)) {
      await replyOnX(tweetId, 'That CA is already on your desk call log.');
    } else {
      await replyOnX(tweetId, `Could not log this call: ${msg.slice(0, 120)}`);
    }
  }
}

/**
 * @param {import('discord.js').Client} discordClient
 */
async function pollMentionDeskCallsOnce(discordClient) {
  if (!mentionDeskEnabled()) return;
  const { isXAutomationPaused } = require('./dashboardAutomationFlags');
  if (await isXAutomationPaused()) return;
  if (!discordClient?.isReady?.()) return;

  const botUserId = await fetchBotUserId();
  if (!botUserId) {
    console.warn('[XMentionDesk] No bot user id (X users/me failed)');
    return;
  }

  const state = loadState();
  const fetchRes = await fetchMentionsSince(botUserId, state.sinceTweetId || null);
  if (!fetchRes.ok) {
    console.error('[XMentionDesk] mentions fetch failed:', fetchRes.httpStatus, fetchRes.error);
    return;
  }

  const tweets = fetchRes.tweets;
  if (tweets.length === 0) {
    return;
  }

  if (!state.primed && !state.sinceTweetId) {
    const mx = maxTweetId(tweets.map(t => t.id));
    if (mx) {
      saveState({ sinceTweetId: mx, primed: true });
      console.log(`[XMentionDesk] Primed — cursor ${mx} (no backlog ingest).`);
    }
    return;
  }

  tweets.sort((a, b) => compareTweetIdAsc(a.id, b.id));

  const usersById = new Map();
  const users = Array.isArray(fetchRes.includes?.users) ? fetchRes.includes.users : [];
  for (const u of users) {
    if (u?.id) usersById.set(String(u.id), u);
  }

  for (const tw of tweets) {
    try {
      await processOneMention(discordClient, tw, fetchRes.includes, usersById);
    } catch (e) {
      console.error('[XMentionDesk] process error:', tw?.id, e?.message || e);
    }
  }

  const mx = maxTweetId(tweets.map(t => t.id));
  if (mx && (!state.sinceTweetId || compareTweetIdAsc(state.sinceTweetId, mx) < 0)) {
    saveState({ sinceTweetId: mx, primed: true });
  }
}

/**
 * @param {import('discord.js').Client} discordClient
 * @returns {null | (() => void)}
 */
function startXMentionDeskCallPoller(discordClient) {
  pollIntervalActive = false;
  if (!mentionDeskEnabled()) {
    console.log(
      '[XMentionDesk] Idle — set X_MENTION_DESK_CALLS_ENABLED=1 and X API creds to poll @mentions for desk calls.'
    );
    return null;
  }

  const intervalMs = resolvePollIntervalMs();
  let busy = false;

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await pollMentionDeskCallsOnce(discordClient);
    } finally {
      busy = false;
    }
  };

  void tick();
  const id = setInterval(() => {
    void tick();
  }, intervalMs);

  pollIntervalActive = true;
  console.log(`[XMentionDesk] Started (every ${Math.round(intervalMs / 1000)}s) — @mentions → Pro desk calls`);
  return () => {
    pollIntervalActive = false;
    clearInterval(id);
  };
}

module.exports = {
  startXMentionDeskCallPoller,
  pollMentionDeskCallsOnce,
  mentionDeskEnabled
};
