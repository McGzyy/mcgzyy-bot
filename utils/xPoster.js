const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');

const { isXPostDryRunEnabled } = require('./xPostPreview');

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
 * OAuth 1.0a signing for GET — query params must be included in the signature parameter string.
 * @param {string} baseUrl — e.g. https://api.x.com/2/users/me (no query string)
 * @param {Record<string, string|number|boolean>} queryParams — API query keys/values only (not oauth_*)
 */
function buildOAuthHeaderGET(baseUrl, queryParams = {}) {
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

  const flatQuery = {};
  for (const [k, v] of Object.entries(queryParams)) {
    if (v == null || v === '') continue;
    flatQuery[k] = String(v);
  }

  const allParams = { ...oauthParams, ...flatQuery };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map(key => `${percentEncode(key)}=${percentEncode(String(allParams[key]))}`)
    .join('&');

  const baseString = ['GET', percentEncode(baseUrl), percentEncode(paramString)].join('&');

  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(accessTokenSecret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  oauthParams.oauth_signature = signature;

  const authHeader =
    'OAuth ' +
    Object.keys(oauthParams)
      .sort()
      .map(key => `${percentEncode(key)}="${percentEncode(oauthParams[key])}"`)
      .join(', ');

  return authHeader;
}

/**
 * Signed GET to X API v2 (user context). Path starts with /users/..., /tweets/..., etc.
 * @param {string} path — e.g. /users/me or /users/123/mentions
 * @param {Record<string, string|number|boolean>} [queryParams]
 */
async function xApiGet(path, queryParams = {}) {
  const pathNorm = path.startsWith('/') ? path : `/${path}`;
  const baseUrl = `${X_API_BASE}${pathNorm}`;

  const flatQuery = {};
  for (const [k, v] of Object.entries(queryParams)) {
    if (v == null || v === '') continue;
    flatQuery[k] = String(v);
  }

  const sortedKeys = Object.keys(flatQuery).sort();
  const qs = sortedKeys
    .map(key => `${percentEncode(key)}=${percentEncode(String(flatQuery[key]))}`)
    .join('&');

  const url = qs ? `${baseUrl}?${qs}` : baseUrl;
  const authHeader = buildOAuthHeaderGET(baseUrl, flatQuery);

  const response = await axios.get(url, {
    headers: { Authorization: authHeader }
  });

  return response.data;
}

const X_MEDIA_UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';

/**
 * Upload PNG via v1.1 multipart (file bytes are not part of the OAuth signature).
 * @param {Buffer} pngBuffer
 * @returns {Promise<string|null>} media_id_string
 */
async function uploadMediaPng(pngBuffer) {
  if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length < 32) return null;

  const authHeader = buildOAuthHeader('POST', X_MEDIA_UPLOAD_URL);

  const form = new FormData();
  form.append('media', pngBuffer, {
    filename: 'chart.png',
    contentType: 'image/png',
    knownLength: pngBuffer.length
  });

  const response = await axios.post(X_MEDIA_UPLOAD_URL, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: authHeader
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 60000
  });

  const id = response?.data?.media_id_string || response?.data?.media_id || null;
  return id ? String(id) : null;
}

/**
 * @param {string} text
 * @param {string|null} [replyToId]
 * @param {{ chartImageBuffer?: Buffer|null }} [postOptions] — optional PNG; upload failures fall back to text-only
 */
async function createPost(text, replyToId = null, postOptions = {}) {
  const chartImageBuffer =
    postOptions && Buffer.isBuffer(postOptions.chartImageBuffer) && postOptions.chartImageBuffer.length > 0
      ? postOptions.chartImageBuffer
      : null;

  if (isXPostDryRunEnabled()) {
    console.log('[XPoster] DRY RUN — skipped live API', {
      wouldReplyToTweetId: replyToId || null,
      charLength: String(text || '').length,
      wouldAttachChart: !!chartImageBuffer,
      chartBytes: chartImageBuffer ? chartImageBuffer.length : 0
    });
    return {
      success: true,
      dryRun: true,
      id: null,
      text,
      wouldReplyToTweetId: replyToId || null,
      chartAttached: false
    };
  }

  const url = `${X_API_BASE}/tweets`;

  let mediaIds = [];
  if (chartImageBuffer) {
    try {
      const mid = await uploadMediaPng(chartImageBuffer);
      if (mid) {
        mediaIds = [mid];
        console.log('[XPoster] Chart media uploaded:', mid);
      }
    } catch (err) {
      console.warn('[XPoster] Chart upload failed — posting text only:', err?.response?.data || err.message);
    }
  }

  const body = {
    text
  };

  if (mediaIds.length) {
    body.media = { media_ids: mediaIds };
  }

  if (replyToId) {
    body.reply = {
      in_reply_to_tweet_id: replyToId
    };
  }

  const authHeader = buildOAuthHeader('POST', url);

  try {
    const response = await axios.post(url, body, {
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json'
      }
    });

    const postId = response?.data?.data?.id || null;
    const postText = response?.data?.data?.text || null;

    return {
      success: true,
      id: postId,
      text: postText,
      raw: response.data,
      chartAttached: mediaIds.length > 0
    };
  } catch (error) {
    console.error('[XPoster] Post failed:', error?.response?.data || error.message);

    return {
      success: false,
      error: error?.response?.data || error.message
    };
  }
}

module.exports = {
  createPost,
  uploadMediaPng,
  buildOAuthHeaderGET,
  xApiGet
};