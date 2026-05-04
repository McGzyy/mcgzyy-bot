const crypto = require('crypto');
const axios = require('axios');

const X_API_BASE = 'https://api.x.com/2';

function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/[!*()']/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildOAuthHeader(method, url, extraParams = {}) {
  const consumerKey = process.env.X_API_KEY;
  const consumerSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessTokenSecret = process.env.X_ACCESS_TOKEN_SECRET;

  if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
    throw new Error('Missing X API credentials in .env');
  }

  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: '1.0'
  };

  const allParams = { ...oauthParams, ...extraParams };

  const sorted = Object.keys(allParams)
    .sort()
    .map(key => `${percentEncode(key)}=${percentEncode(allParams[key])}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(sorted)
  ].join('&');

  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(accessTokenSecret)}`;

  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(baseString)
    .digest('base64');

  oauthParams.oauth_signature = signature;

  const authHeader = 'OAuth ' + Object.keys(oauthParams)
    .sort()
    .map(key => `${percentEncode(key)}="${percentEncode(oauthParams[key])}"`)
    .join(', ');

  return authHeader;
}

/**
 * OAuth 1.0a signed GET (query params must appear in both URL and signature).
 * @param {string} baseUrlNoQuery e.g. https://api.x.com/2/dm_events
 * @param {Record<string, string>} queryParams
 */
async function oauth1aGet(baseUrlNoQuery, queryParams = {}) {
  const authHeader = buildOAuthHeader('GET', baseUrlNoQuery, queryParams);
  const qs = Object.keys(queryParams)
    .sort()
    .map(key => `${percentEncode(key)}=${percentEncode(String(queryParams[key]))}`)
    .join('&');

  const url = qs ? `${baseUrlNoQuery}?${qs}` : baseUrlNoQuery;

  return axios.get(url, {
    headers: {
      Authorization: authHeader
    }
  });
}

/**
 * Recent DM MessageCreate events for the authenticated X user (McGBot inbox).
 * Requires X app + access token with Direct Message read permission.
 * @returns {Promise<{ ok: boolean, events: Array<{ id: string, text: string, senderId: string }>, usersById: Map<string, { id: string, username?: string }>, nextToken?: string, error?: unknown, httpStatus?: number }>}
 */
async function listDmMessageCreates({ maxResults = 50, paginationToken = null } = {}) {
  const baseUrl = `${X_API_BASE}/dm_events`;
  const query = {
    max_results: String(Math.min(100, Math.max(1, Number(maxResults) || 50))),
    event_types: 'MessageCreate',
    'dm_event.fields': 'id,event_type,text,created_at,sender_id',
    expansions: 'sender_id',
    'user.fields': 'username'
  };

  if (paginationToken) {
    query.pagination_token = String(paginationToken);
  }

  try {
    const response = await oauth1aGet(baseUrl, query);
    const payload = response?.data || {};
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const usersById = new Map();

    for (const u of payload.includes?.users || []) {
      if (u && u.id) {
        usersById.set(String(u.id), { id: String(u.id), username: u.username });
      }
    }

    const events = [];

    for (const row of rows) {
      const id = row.id != null ? String(row.id) : '';
      const senderId = row.sender_id != null ? String(row.sender_id) : '';
      const text = row.text != null ? String(row.text) : '';

      if (!id || !senderId) {
        continue;
      }

      events.push({ id, text, senderId, createdAt: row.created_at || null });
    }

    return {
      ok: true,
      events,
      usersById,
      nextToken: payload.meta?.next_token || null
    };
  } catch (error) {
    const httpStatus = error?.response?.status;
    return {
      ok: false,
      events: [],
      usersById: new Map(),
      error: error?.response?.data || error.message,
      httpStatus
    };
  }
}

/**
 * @param {string[]} userIds
 * @returns {Promise<Map<string, string>>} user id -> username (as returned by the API)
 */
async function lookupXUsernamesByIds(userIds) {
  const unique = [...new Set((userIds || []).map(String).filter(Boolean))].slice(0, 100);
  const out = new Map();

  if (!unique.length) {
    return out;
  }

  const baseUrl = `${X_API_BASE}/users`;
  const query = {
    ids: unique.join(','),
    'user.fields': 'username'
  };

  try {
    const response = await oauth1aGet(baseUrl, query);
    const users = response?.data?.data;
    if (!Array.isArray(users)) {
      return out;
    }

    for (const u of users) {
      if (u?.id && u.username) {
        out.set(String(u.id), String(u.username));
      }
    }
  } catch (error) {
    console.error('[XPoster] users lookup failed:', error?.response?.data || error.message);
  }

  return out;
}

/**
 * Authenticated X user (the account tied to X_ACCESS_TOKEN).
 * @returns {Promise<{ id: string, username: string } | null>}
 */
async function fetchXAuthenticatedUser() {
  const baseUrl = `${X_API_BASE}/users/me`;
  const query = { 'user.fields': 'id,username' };

  try {
    const response = await oauth1aGet(baseUrl, query);
    const u = response?.data?.data;
    if (!u?.id) {
      return null;
    }

    return { id: String(u.id), username: String(u.username || '') };
  } catch (error) {
    console.error('[XPoster] users/me failed:', error?.response?.data || error.message);
    return null;
  }
}

/**
 * chartjs-node-canvas / canvas may return Buffer or Uint8Array; X upload expects a real Buffer + PNG signature.
 * @param {unknown} raw
 * @returns {Buffer | null}
 */
function normalizePngUploadBuffer(raw) {
  if (raw == null) return null;
  let buf;
  try {
    // Always copy when `raw` is already a Buffer: chart/canvas code may return
    // views into pooled native memory; reusing the same reference across async
    // upload can corrupt bytes before the request is sent.
    buf = Buffer.isBuffer(raw)
      ? Buffer.from(raw)
      : Buffer.from(/** @type {Uint8Array} */ (raw));
  } catch {
    return null;
  }
  if (!buf.length || buf.length < 68) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    console.error('[XPoster] normalizePngUploadBuffer: not a PNG (bad signature)');
    return null;
  }
  return buf;
}

async function uploadMediaPng(buffer) {
  const buf = normalizePngUploadBuffer(buffer);
  if (!buf) return null;

  const uploadUrl = 'https://upload.twitter.com/1.1/media/upload.json';
  const authHeader = buildOAuthHeader('POST', uploadUrl);

  const params = new URLSearchParams();
  params.set('media_data', buf.toString('base64'));
  /** Helps X attach images to v2 tweets; see X media upload docs. */
  params.set('media_category', 'tweet_image');

  try {
    const response = await axios.post(uploadUrl, params.toString(), {
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const d = response?.data;
    if (d?.errors?.length) {
      console.error('[XPoster] Media upload response contained errors:', JSON.stringify(d.errors));
      return null;
    }
    // Never use numeric `media_id` — large snowflakes lose precision in JS; v2 needs exact string id.
    const id = d?.media_id_string;
    if (id != null && id !== '') {
      return String(id);
    }
    console.error('[XPoster] Media upload: missing media_id_string in response keys=', d ? Object.keys(d) : []);
    return null;
  } catch (error) {
    console.error('[XPoster] Media upload failed:', error?.response?.data || error.message);
    return null;
  }
}

/**
 * @param {string} text
 * @param {string | null} [replyToId]
 * @param {Buffer | Uint8Array | null} [mediaPngBuffer] uploaded when set (unless `options.preUploadedMediaId` is set)
 * @param {{ preUploadedMediaId?: string } | null} [options] pass `preUploadedMediaId` when the caller already called `uploadMediaPng`
 */
async function createPost(text, replyToId = null, mediaPngBuffer = null, options = null) {
  const url = `${X_API_BASE}/tweets`;

  const body = {
    text
  };

  if (replyToId) {
    body.reply = {
      in_reply_to_tweet_id: replyToId
    };
  }

  const preUploadedMediaId =
    options && typeof options === 'object' && options.preUploadedMediaId != null
      ? String(options.preUploadedMediaId).trim()
      : '';

  let mediaId = preUploadedMediaId || null;
  if (!mediaId && mediaPngBuffer && !replyToId) {
    try {
      mediaId = await uploadMediaPng(mediaPngBuffer);
      if (!mediaId) {
        const n = normalizePngUploadBuffer(mediaPngBuffer)?.length ?? 0;
        console.error(
          `[XPoster] Media upload skipped or failed (png bytes=${n}). Tweet will be text-only.`
        );
      }
    } catch (e) {
      mediaId = null;
      console.error('[XPoster] Media upload exception:', e?.message || e);
    }
  }
  if (mediaId && !replyToId) {
    body.media = { media_ids: [String(mediaId)] };
  }

  const authHeader = buildOAuthHeader('POST', url);

  try {
    const response = await axios.post(url, body, {
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json'
      }
    });

    const payload = response?.data?.data || {};
    const postId = payload.id || null;
    const postText = payload.text || null;
    if (body.media?.media_ids?.length) {
      console.log('[XPoster] Tweet created with media_ids=', body.media.media_ids, 'id=', postId);
    }

    return {
      success: true,
      id: postId,
      text: postText,
      raw: response.data
    };
  } catch (error) {
    console.error('[XPoster] Post failed:', error?.response?.data || error.message);

    return {
      success: false,
      error: error?.response?.data || error.message
    };
  }
}

function getXBotUsernameForCopy() {
  const raw = String(process.env.X_BOT_USERNAME || 'McGBot')
    .trim()
    .replace(/^@+/, '');
  const cleaned = raw.replace(/[^\w]/g, '').slice(0, 15);
  return cleaned || 'McGBot';
}

module.exports = {
  createPost,
  uploadMediaPng,
  normalizePngUploadBuffer,
  buildOAuthHeader,
  oauth1aGet,
  listDmMessageCreates,
  lookupXUsernamesByIds,
  fetchXAuthenticatedUser,
  getXBotUsernameForCopy
};