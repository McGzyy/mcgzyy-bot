'use strict';

const crypto = require('crypto');
const path = require('path');
const axios = require('axios');
const { writeJson } = require('./jsonStore');

/** X API v2 OAuth2 + user endpoints (must match token host used at exchange). */
const TWITTER_OAUTH2_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const TWITTER_USERS_ME_URL = 'https://api.twitter.com/2/users/me';

/**
 * Twitter expects Basic credentials built from URL-encoded client id and secret.
 * @param {string} clientId
 * @param {string} clientSecret
 */
function twitterClientBasicAuthHeader(clientId, clientSecret) {
  const id = encodeURIComponent(String(clientId || '').trim());
  const secret = encodeURIComponent(String(clientSecret || '').trim());
  const basic = Buffer.from(`${id}:${secret}`, 'utf8').toString('base64');
  return `Basic ${basic}`;
}

/**
 * @param {unknown} data
 * @returns {Record<string, unknown>}
 */
function parseTokenResponseBody(data) {
  if (data && typeof data === 'object' && !Buffer.isBuffer(data)) {
    return /** @type {Record<string, unknown>} */ (data);
  }
  if (typeof data === 'string' && data.trim()) {
    try {
      return /** @type {Record<string, unknown>} */ (JSON.parse(data));
    } catch {
      return {};
    }
  }
  return {};
}

const TTL_MS = 15 * 60 * 1000;

/** Same-directory pattern as userProfileService — survives PM2 restarts (in-memory Map did not). */
const X_OAUTH_PENDING_FILE = path.join(__dirname, '../data/x_oauth_pending.json');

/**
 * @param {Record<string, unknown>} obj
 */
function prunePendingObject(obj) {
  const now = Date.now();
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      delete obj[k];
      continue;
    }
    const exp = Number(/** @type {{ expiresAt?: unknown }} */ (v).expiresAt) || 0;
    if (exp < now) delete obj[k];
  }
}

/**
 * @param {(obj: Record<string, unknown>, writeParsed: (data: unknown) => Promise<void>) => Promise<T>} handler
 * @returns {Promise<T>}
 * @template T
 */
async function withPendingStore(handler) {
  const lock = writeJson.withFileLock;
  if (typeof lock !== 'function') {
    throw new Error('[x-oauth] writeJson.withFileLock missing (jsonStore)');
  }
  return lock(X_OAUTH_PENDING_FILE, async ({ readParsed, writeParsed }) => {
    let obj = {};
    try {
      const data = await readParsed();
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        obj = /** @type {Record<string, unknown>} */ (data);
      }
    } catch (e) {
      const code = e && /** @type {{ code?: string }} */ (e).code;
      if (code !== 'ENOENT') throw e;
    }
    return handler(obj, writeParsed);
  });
}

/**
 * @param {string} state
 * @param {{ codeVerifier: string, discordUserId: string, expiresAt: number }} record
 */
async function savePendingOAuthState(state, record) {
  return withPendingStore(async (obj, writeParsed) => {
    prunePendingObject(obj);
    obj[state] = record;
    await writeParsed(obj);
  });
}

/**
 * Atomically load and remove one pending row (single use — retry after failure requires new Connect X).
 * @param {string} state
 * @returns {Promise<{ codeVerifier: string, discordUserId: string } | null>}
 */
async function takePendingOAuthState(state) {
  return withPendingStore(async (obj, writeParsed) => {
    prunePendingObject(obj);
    const raw = obj[state];
    delete obj[state];
    await writeParsed(obj);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }
    const exp = Number(/** @type {{ expiresAt?: unknown }} */ (raw).expiresAt) || 0;
    if (exp < Date.now()) {
      return null;
    }
    return {
      codeVerifier: String(/** @type {{ codeVerifier?: unknown }} */ (raw).codeVerifier || ''),
      discordUserId: String(/** @type {{ discordUserId?: unknown }} */ (raw).discordUserId || '')
    };
  });
}

function internalBearerOk(req) {
  const secret = String(process.env.CALL_INTERNAL_SECRET || '').trim();
  const auth = String(req.headers.authorization || '').trim();
  return !!(secret && auth === `Bearer ${secret}`);
}

function getXOAuth2Config() {
  const clientId = String(process.env.X_OAUTH2_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.X_OAUTH2_CLIENT_SECRET || '').trim();
  const redirectUri = String(process.env.X_OAUTH2_REDIRECT_URI || '').trim();
  return { clientId, clientSecret, redirectUri };
}

/**
 * POST /internal/x-oauth/start — body: { userId }
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleXOauthStart(req, res) {
  try {
    if (!internalBearerOk(req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { clientId, clientSecret, redirectUri } = getXOAuth2Config();
    if (!clientId || !clientSecret || !redirectUri) {
      res.status(503).json({
        error:
          'X OAuth2 is not configured on the bot API host. Set X_OAUTH2_CLIENT_ID, X_OAUTH2_CLIENT_SECRET, and X_OAUTH2_REDIRECT_URI (must match the callback URL in the X developer portal, e.g. https://your-site.com/api/x/oauth/callback).'
      });
      return;
    }

    const userId = String(req.body?.userId || '').trim();
    if (!userId) {
      res.status(400).json({ error: 'Missing userId' });
      return;
    }

    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    const state = crypto.randomBytes(24).toString('hex');

    try {
      await savePendingOAuthState(state, {
        codeVerifier,
        discordUserId: userId,
        expiresAt: Date.now() + TTL_MS
      });
    } catch (e) {
      console.error('[API] x-oauth/start persist pending', e?.message || e);
      res.status(503).json({
        error:
          'Could not persist OAuth state on the bot host (check data/ directory permissions and disk space).'
      });
      return;
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'users.read tweet.read offline.access',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });

    const authUrl = `https://x.com/i/oauth2/authorize?${params.toString()}`;
    res.json({ success: true, authUrl });
  } catch (e) {
    console.error('[API] x-oauth/start', e?.message || e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

/**
 * POST /internal/x-oauth/complete — body: { code, state }
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleXOauthComplete(req, res) {
  try {
    if (!internalBearerOk(req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { clientId, clientSecret, redirectUri } = getXOAuth2Config();
    if (!clientId || !clientSecret || !redirectUri) {
      res.status(503).json({ error: 'X OAuth2 is not configured on the bot API host.' });
      return;
    }

    const code = String(req.body?.code || '').trim();
    const state = String(req.body?.state || '').trim();
    if (!code || !state) {
      res.status(400).json({ error: 'Missing code or state' });
      return;
    }

    let pending;
    try {
      pending = await takePendingOAuthState(state);
    } catch (e) {
      console.error('[API] x-oauth/complete load pending', e?.message || e);
      res.status(503).json({ error: 'oauth_state_store_unavailable' });
      return;
    }
    if (!pending || !pending.codeVerifier) {
      res.status(400).json({ error: 'Invalid or expired OAuth state; start Connect X again.' });
      return;
    }

    // Confidential client + PKCE: client credentials via Basic; never send env X_ACCESS_TOKEN / OAuth1a here.
    const tokenForm = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: String(pending.codeVerifier)
    });

    let tokenRes;
    try {
      tokenRes = await axios.post(TWITTER_OAUTH2_TOKEN_URL, tokenForm.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: twitterClientBasicAuthHeader(clientId, clientSecret)
        },
        // Do not use axios `auth` option — keep token exchange isolated from any other auth style.
        validateStatus: () => true
      });
    } catch (e) {
      console.error('[API] x-oauth/token request', e?.message || e);
      res.status(502).json({ error: 'token_exchange_unreachable' });
      return;
    }

    if (tokenRes.status < 200 || tokenRes.status >= 300) {
      const errData = parseTokenResponseBody(tokenRes.data);
      const msg =
        (typeof errData.error_description === 'string' && errData.error_description) ||
        (typeof errData.error === 'string' && errData.error) ||
        JSON.stringify(errData);
      console.error('[API] x-oauth/token', tokenRes.status, msg);
      res.status(400).json({ success: false, error: `token_exchange_failed: ${String(msg).slice(0, 200)}` });
      return;
    }

    const tokenPayload = parseTokenResponseBody(tokenRes.data);
    // Flow: exchange code at /2/oauth2/token → read access_token from JSON body only (no env app/user bearer).
    const access_token = String(tokenPayload.access_token || '').trim();
    if (!access_token) {
      res.status(400).json({ success: false, error: 'token_exchange_no_access_token' });
      return;
    }

    const tokenType = String(tokenPayload.token_type || '').toLowerCase();
    const tokenScope = typeof tokenPayload.scope === 'string' ? tokenPayload.scope : '';
    console.log(
      '[API] x-oauth: access_token from OAuth2 authorization_code exchange at %s (token_type=%s scope=%s); same value used for GET /2/users/me — not X_BEARER_TOKEN / not app token / not X_ACCESS_TOKEN',
      TWITTER_OAUTH2_TOKEN_URL,
      tokenType || '(missing)',
      tokenScope || '(none)'
    );

    // GET https://api.twitter.com/2/users/me — Authorization MUST be Bearer + access_token from exchange above only.
    let meRes;
    try {
      meRes = await axios.get(TWITTER_USERS_ME_URL, {
        params: { 'user.fields': 'id,username' },
        headers: {
          Authorization: `Bearer ${access_token}`
        },
        validateStatus: () => true
      });
    } catch (e) {
      console.error('[API] x-oauth/users/me', e?.message || e);
      res.status(502).json({ success: false, error: 'users_me_unreachable' });
      return;
    }

    if (meRes.status < 200 || meRes.status >= 300) {
      const tokHint = access_token
        ? `${access_token.slice(0, 6)}…${access_token.slice(-4)}`
        : '(empty)';
      console.error(
        '[API] x-oauth/users/me',
        meRes.status,
        'called with Bearer from OAuth2 exchange only; token_prefix=',
        tokHint,
        meRes.data
      );
      res.status(400).json({ success: false, error: 'users_me_failed' });
      return;
    }

    console.log(
      '[API] x-oauth/users/me OK using Bearer token from OAuth2 exchange (same access_token as logged above; not X_ACCESS_TOKEN env / not app-only)'
    );

    const username = String(meRes.data?.data?.username || '').trim().replace(/^@+/, '');
    if (!username) {
      res.status(400).json({ success: false, error: 'users_me_no_username' });
      return;
    }

    res.json({
      success: true,
      username,
      discordUserId: pending.discordUserId
    });
  } catch (e) {
    console.error('[API] x-oauth/complete', e?.message || e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

/**
 * POST /internal/x-oauth/unlink — body: { userId }
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function handleXOauthUnlink(req, res) {
  try {
    if (!internalBearerOk(req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json({ success: true });
  } catch (e) {
    console.error('[API] x-oauth/unlink', e?.message || e);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports = {
  handleXOauthStart,
  handleXOauthComplete,
  handleXOauthUnlink
};
