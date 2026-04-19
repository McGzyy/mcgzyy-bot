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

async function uploadMediaPng(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 100) return null;

  const uploadUrl = 'https://upload.twitter.com/1.1/media/upload.json';
  const authHeader = buildOAuthHeader('POST', uploadUrl);

  const params = new URLSearchParams();
  params.set('media_data', buffer.toString('base64'));

  try {
    const response = await axios.post(uploadUrl, params.toString(), {
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    return response?.data?.media_id_string || null;
  } catch (error) {
    console.error('[XPoster] Media upload failed:', error?.response?.data || error.message);
    return null;
  }
}

async function createPost(text, replyToId = null, mediaPngBuffer = null) {
  const url = `${X_API_BASE}/tweets`;

  const body = {
    text
  };

  if (replyToId) {
    body.reply = {
      in_reply_to_tweet_id: replyToId
    };
  }

  let mediaId = null;
  if (mediaPngBuffer && !replyToId) {
    try {
      mediaId = await uploadMediaPng(mediaPngBuffer);
    } catch (_) {
      mediaId = null;
    }
    if (mediaId) {
      body.media = { media_ids: [mediaId] };
    }
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

module.exports = {
  createPost,
  uploadMediaPng,
  buildOAuthHeader
};