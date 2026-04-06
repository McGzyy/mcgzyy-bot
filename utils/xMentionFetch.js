/**
 * X API v2 — fetch mentions of the authenticated (bot) user for mention ingestion.
 *
 * Strategy: OAuth 1.0a user-context GET
 *   1) GET /2/users/me — resolve bot numeric id (cached; skip if X_BOT_USER_ID is set)
 *   2) GET /2/users/:id/mentions — recent mentions (paginated by X; we take one page per poll)
 *
 * Reprocessing: intake still uses data/xIntakeProcessedTweetIds.json (xIntakeDedupeService).
 * Re-fetching the same tweet id in a later poll is safe: already_processed short-circuits before apply.
 *
 * Env (credentials shared with posting):
 *   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
 * Optional:
 *   X_BOT_USER_ID — numeric user id of the bot (skips /users/me)
 *   X_MENTION_FETCH_MAX — batch size 5–100, default 10
 */

const { xApiGet } = require('./xPoster');

function clampMaxResults(n) {
  if (!Number.isFinite(n)) return 10;
  return Math.min(100, Math.max(5, Math.floor(n)));
}

function maxMentionBatchSize() {
  const n = Number(process.env.X_MENTION_FETCH_MAX || 10);
  return clampMaxResults(n);
}

let cachedBotUserId = null;

function hasUserContextCredentials() {
  return !!(
    process.env.X_API_KEY &&
    process.env.X_API_SECRET &&
    process.env.X_ACCESS_TOKEN &&
    process.env.X_ACCESS_TOKEN_SECRET
  );
}

async function resolveBotUserId() {
  const fromEnv = String(process.env.X_BOT_USER_ID || '').trim();
  if (fromEnv) {
    cachedBotUserId = fromEnv;
    return fromEnv;
  }
  if (cachedBotUserId) return cachedBotUserId;

  const data = await xApiGet('/users/me', { 'user.fields': 'username' });
  const id = data?.data?.id;
  if (!id) {
    throw new Error('X API /2/users/me returned no user id');
  }
  cachedBotUserId = String(id);
  return cachedBotUserId;
}

function compareTweetIdsAsc(a, b) {
  try {
    const ba = BigInt(a);
    const bb = BigInt(b);
    if (ba < bb) return -1;
    if (ba > bb) return 1;
    return 0;
  } catch {
    return String(a).localeCompare(String(b));
  }
}

/**
 * @param {object} payload — X API v2 JSON body for user mentions
 */
function mapMentionPayloadToCandidates(payload) {
  const tweets = Array.isArray(payload?.data) ? payload.data : [];
  const users = Array.isArray(payload?.includes?.users) ? payload.includes.users : [];
  const userById = new Map(users.map(u => [String(u.id), u]));

  const out = [];
  for (const t of tweets) {
    const id = t?.id != null ? String(t.id) : '';
    const text = t?.text != null ? String(t.text) : '';
    const authorId = t?.author_id != null ? String(t.author_id) : '';
    if (!id || !text) continue;

    const author = userById.get(authorId);
    const authorHandle = author?.username != null ? String(author.username).replace(/^@+/, '') : '';
    if (!authorHandle) continue;

    let replyToTweetId;
    const refs = Array.isArray(t.referenced_tweets) ? t.referenced_tweets : [];
    const replied = refs.find(r => r && String(r.type) === 'replied_to');
    if (replied?.id != null) {
      replyToTweetId = String(replied.id);
    }

    out.push({
      authorHandle,
      tweetText: text,
      tweetId: id,
      ...(replyToTweetId ? { replyToTweetId } : {})
    });
  }

  out.sort((a, b) => compareTweetIdsAsc(a.tweetId, b.tweetId));
  return out;
}

/**
 * @returns {Promise<Array<{ authorHandle: string, tweetText: string, tweetId: string, replyToTweetId?: string }>>}
 */
async function fetchXMentionCandidatesFromApi() {
  if (!hasUserContextCredentials()) {
    console.warn('[XMentionFetch] Missing X user-context credentials — returning no candidates');
    return [];
  }

  try {
    const userId = await resolveBotUserId();
    const maxResults = maxMentionBatchSize();

    const params = {
      max_results: maxResults,
      'tweet.fields': 'author_id,text,referenced_tweets',
      expansions: 'author_id',
      'user.fields': 'username'
    };

    const path = `/users/${encodeURIComponent(userId)}/mentions`;
    const t0 = Date.now();
    const data = await xApiGet(path, params);
    const durationMs = Date.now() - t0;

    const rawCount = Array.isArray(data?.data) ? data.data.length : 0;
    const candidates = mapMentionPayloadToCandidates(data);
    const dropped = Math.max(0, rawCount - candidates.length);
    console.log(
      `[XFetch] rawTweets=${rawCount} mapped=${candidates.length} dropped=${dropped} durationMs=${durationMs}`
    );
    console.log(
      `[XMentionFetch] GET /users/${userId}/mentions → raw tweets=${rawCount}, mapped candidates=${candidates.length}`
    );

    if (rawCount === 0) {
      console.log('[XMentionFetch] API page empty (no mention tweets in this batch).');
    } else if (candidates.length < rawCount) {
      console.log(
        `[XMentionFetch] ${rawCount - candidates.length} tweet(s) dropped (missing author/username in expansions)`
      );
    }

    return candidates;
  } catch (err) {
    const status = err?.response?.status;
    let body = err?.response?.data;
    let bodyShort = '';
    if (body != null) {
      const s = typeof body === 'string' ? body : JSON.stringify(body);
      bodyShort = s.length > 500 ? `${s.slice(0, 500)}…` : s;
    }
    console.error('[XMentionFetch] X API error:', {
      status: status != null ? status : 'n/a',
      message: err?.message || String(err),
      body: bodyShort || undefined
    });
    return [];
  }
}

module.exports = {
  fetchXMentionCandidatesFromApi,
  hasUserContextCredentials,
  mapMentionPayloadToCandidates
};
