'use strict';

const { extractMediaUrlsFromTweet } = require('./outsideIngestPolicy');

const MINT_RE = /\b([1-9A-HJ-NP-Za-km-z]{32,44})(?:pump)?\b/i;

function getBotHandleNormalized() {
  return String(process.env.X_BOT_USERNAME || 'McGBot')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

function stripBotMentions(text) {
  const h = getBotHandleNormalized();
  if (!h) return String(text || '').trim();
  const re = new RegExp(`@${h}\\b`, 'gi');
  return String(text || '')
    .replace(re, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFirstMint(text) {
  const m = String(text || '').match(MINT_RE);
  return m && m[1] ? String(m[1]).trim() : '';
}

/**
 * @param {string} text
 * @param {string} mint
 */
function buildCallNarrative(text, mint) {
  let n = stripBotMentions(text);
  const key = String(mint || '').trim();
  if (key) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    n = n.replace(new RegExp(esc, 'g'), ' ').replace(/(?:pump)\b/gi, ' ');
  }
  n = n.replace(/\s+/g, ' ').trim();
  if (n.length < 8) return null;
  return n.slice(0, 4000);
}

function normalizeMediaUrls(urls) {
  if (!Array.isArray(urls)) return [];
  const out = [];
  for (const u of urls) {
    const s = String(u ?? '').trim();
    if (!s || !/^https?:\/\//i.test(s)) continue;
    if (!out.includes(s)) out.push(s);
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * @param {{ id: string, text: string, raw?: object }} tweet
 * @param {object} [includes]
 * @param {{ allowNarrative: boolean }} opts
 */
function parseMentionDeskCallTweet(tweet, includes, opts = {}) {
  const text = String(tweet?.text || '');
  const mint = extractFirstMint(text);
  const allowNarrative = opts.allowNarrative === true;
  const narrative = allowNarrative && mint ? buildCallNarrative(text, mint) : null;
  const mediaUrls =
    allowNarrative && mint ? normalizeMediaUrls(extractMediaUrlsFromTweet(tweet?.raw || tweet, includes)) : [];

  return {
    mint,
    narrative,
    mediaUrls,
    hasMint: Boolean(mint)
  };
}

module.exports = {
  getBotHandleNormalized,
  stripBotMentions,
  extractFirstMint,
  buildCallNarrative,
  parseMentionDeskCallTweet,
  normalizeMediaUrls
};
