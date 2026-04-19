'use strict';

const crypto = require('crypto');
const axios = require('axios');

const STATE_TTL_MS = 15 * 60 * 1000;

/** @type {Map<string, { discordUserId: string, codeVerifier: string, createdAt: number }>} */
const pendingByState = new Map();

const AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const ME_URL = 'https://api.twitter.com/2/users/me';

function pruneExpiredStates() {
  const now = Date.now();
  for (const [state, row] of pendingByState.entries()) {
    if (now - row.createdAt > STATE_TTL_MS) {
      pendingByState.delete(state);
    }
  }
}

function randomPkceVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function pkceChallengeFromVerifier(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function getOAuthEnv() {
  const clientId = String(process.env.X_OAUTH2_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.X_OAUTH2_CLIENT_SECRET || '').trim();
  const redirectUri = String(process.env.X_OAUTH2_REDIRECT_URI || '').trim();
  return { clientId, clientSecret, redirectUri };
}

function assertOAuthConfigured() {
  const { clientId, clientSecret, redirectUri } = getOAuthEnv();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Missing X_OAUTH2_CLIENT_ID, X_OAUTH2_CLIENT_SECRET, or X_OAUTH2_REDIRECT_URI in environment'
    );
  }
  return { clientId, clientSecret, redirectUri };
}

function isXOAuthConfigured() {
  try {
    assertOAuthConfigured();
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} discordUserId
 * @returns {{ authUrl: string, state: string }}
 */
function createXOAuthAuthorizeUrl(discordUserId) {
  const uid = String(discordUserId || '').trim();
  if (!uid) {
    throw new Error('Missing Discord user id');
  }

  const { clientId, clientSecret, redirectUri } = assertOAuthConfigured();

  pruneExpiredStates();

  const codeVerifier = randomPkceVerifier();
  const codeChallenge = pkceChallengeFromVerifier(codeVerifier);
  const state = crypto.randomBytes(24).toString('hex');

  pendingByState.set(state, {
    discordUserId: uid,
    codeVerifier,
    createdAt: Date.now()
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'users.read offline.access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });

  const authUrl = `${AUTH_URL}?${params.toString()}`;
  return { authUrl, state };
}

/**
 * @param {{ code: string, state: string }} input
 * @returns {Promise<{ discordUserId: string, username: string }>}
 */
async function completeXOAuthCallback({ code, state }) {
  const codeStr = String(code || '').trim();
  const stateStr = String(state || '').trim();
  if (!codeStr || !stateStr) {
    throw new Error('Missing code or state');
  }

  const { clientId, clientSecret, redirectUri } = assertOAuthConfigured();

  pruneExpiredStates();

  const row = pendingByState.get(stateStr);
  if (!row || Date.now() - row.createdAt > STATE_TTL_MS) {
    throw new Error('Invalid or expired OAuth state; start linking again from Discord or the dashboard');
  }

  pendingByState.delete(stateStr);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: codeStr,
    redirect_uri: redirectUri,
    code_verifier: row.codeVerifier,
    client_id: clientId
  });

  const tokenRes = await axios.post(TOKEN_URL, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    auth: {
      username: clientId,
      password: clientSecret
    },
    validateStatus: () => true
  });

  if (tokenRes.status < 200 || tokenRes.status >= 300) {
    const detail = tokenRes.data || tokenRes.statusText;
    throw new Error(
      typeof detail === 'string' ? detail : `Token exchange failed (${tokenRes.status})`
    );
  }

  const accessToken = tokenRes.data && tokenRes.data.access_token;
  if (!accessToken) {
    throw new Error('No access_token in token response');
  }

  const meRes = await axios.get(ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { 'user.fields': 'username' },
    validateStatus: () => true
  });

  if (meRes.status < 200 || meRes.status >= 300) {
    const detail = meRes.data || meRes.statusText;
    throw new Error(
      typeof detail === 'string' ? detail : `users/me failed (${meRes.status})`
    );
  }

  const username = meRes.data && meRes.data.data && meRes.data.data.username;
  if (!username || typeof username !== 'string') {
    throw new Error('Could not read X username from users/me');
  }

  return {
    discordUserId: row.discordUserId,
    username: username.replace(/^@+/, '').trim()
  };
}

module.exports = {
  isXOAuthConfigured,
  createXOAuthAuthorizeUrl,
  completeXOAuthCallback
};
