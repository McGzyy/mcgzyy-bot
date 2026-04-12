'use strict';

const fs = require('fs');
const path = require('path');

const HELP_TOPICS_PATH = path.join(__dirname, '..', 'data', 'helpTopics.json');
const MIN_SCORE = 1;

const SCORE_KEYWORD_FULL = 2;
const SCORE_SYNONYM_FULL = 1;
const SCORE_PARTIAL_TOKEN = 0.5;

let topicsCache = null;
let cacheReady = false;

/** @returns {object[] | null} */
function loadTopicsArray() {
  if (cacheReady) return topicsCache;

  try {
    const raw = fs.readFileSync(HELP_TOPICS_PATH, 'utf8');
    const data = JSON.parse(raw);
    const topics = data?.topics;
    if (!Array.isArray(topics)) {
      topicsCache = null;
      cacheReady = true;
      return null;
    }
    topicsCache = topics;
    cacheReady = true;
    return topicsCache;
  } catch {
    topicsCache = null;
    cacheReady = true;
    return null;
  }
}

/**
 * Lowercase question → word-like tokens (letters, digits, leading !).
 * @param {string} question
 * @returns {string[]}
 */
function questionWords(question) {
  const q = String(question || '').toLowerCase().trim();
  return q.match(/!?[a-z0-9]+/g) || [];
}

/**
 * @param {string} phrase
 * @returns {string[]}
 */
function extractTokens(phrase) {
  return String(phrase || '')
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
}

/**
 * @param {string} keyword
 * @param {Set<string>} wordSet
 * @returns {boolean}
 */
function keywordMatchesTokens(keyword, wordSet) {
  const k = String(keyword || '').toLowerCase().trim();
  if (!k) return false;

  if (k.includes(' ')) {
    const parts = k.split(/\s+/).filter(Boolean);
    return parts.length > 0 && parts.every((p) => wordSet.has(p));
  }

  if (wordSet.has(k)) return true;
  if (k.startsWith('!') && wordSet.has(k.slice(1))) return true;
  if (!k.startsWith('!') && wordSet.has(`!${k}`)) return true;

  return false;
}

/**
 * Partial overlap for a single token (length ≥ 3).
 * Caller skips tokens already covered by a full keyword/synonym phrase match.
 *
 * @param {string} t
 * @param {string[]} words
 * @param {Set<string>} wordSet
 * @param {string} qLower
 * @returns {boolean}
 */
function partialWordMatch(t, words, wordSet, qLower) {
  if (t.length < 3) return false;

  if (wordSet.has(t)) return true;
  if (qLower.includes(t)) return true;

  for (const w of words) {
    if (w.length < 3 || w === t) continue;
    if (w.includes(t) || t.includes(w)) return true;
  }

  return false;
}

/**
 * @param {string} question
 * @param {{ keywords?: string[], synonyms?: string[] }} topic
 * @returns {number}
 */
function scoreTopic(question, topic) {
  const words = questionWords(question);
  const wordSet = new Set(words);
  const qLower = String(question || '').toLowerCase().trim();

  const keywords = Array.isArray(topic.keywords) ? topic.keywords : [];
  const synonyms = Array.isArray(topic.synonyms) ? topic.synonyms : [];

  let score = 0;
  const tokensFromFullMatch = new Set();

  for (const kw of keywords) {
    if (keywordMatchesTokens(kw, wordSet)) {
      score += SCORE_KEYWORD_FULL;
      for (const t of extractTokens(kw)) tokensFromFullMatch.add(t);
    }
  }

  for (const syn of synonyms) {
    if (keywordMatchesTokens(syn, wordSet)) {
      score += SCORE_SYNONYM_FULL;
      for (const t of extractTokens(syn)) tokensFromFullMatch.add(t);
    }
  }

  const partialSeen = new Set();
  for (const phrase of [...keywords, ...synonyms]) {
    for (const t of extractTokens(phrase)) {
      if (t.length < 3) continue;
      if (tokensFromFullMatch.has(t)) continue;
      if (partialSeen.has(t)) continue;
      if (partialWordMatch(t, words, wordSet, qLower)) {
        score += SCORE_PARTIAL_TOKEN;
        partialSeen.add(t);
      }
    }
  }

  return score;
}

/**
 * Match a free-text help question to the best topic from data/helpTopics.json.
 * Pure logic — no Discord I/O.
 *
 * @param {string} question
 * @returns {object | null} Full topic object, or null if no load/topics or best score < MIN_SCORE
 */
function matchHelpTopic(question) {
  const topics = loadTopicsArray();
  if (!topics || !topics.length) return null;

  const words = questionWords(question);
  if (!words.length) return null;

  let best = null;
  let bestScore = 0;

  for (const topic of topics) {
    if (!topic || typeof topic !== 'object') continue;
    const s = scoreTopic(question, topic);
    if (s > bestScore) {
      bestScore = s;
      best = topic;
    }
  }

  if (bestScore < MIN_SCORE) return null;
  return best;
}

/**
 * Softer overlap for “did you mean” hints when `matchHelpTopic` returns null.
 * Scores shared tokens (length ≥ 3) from keywords, synonyms, and title.
 *
 * @param {string} question
 * @param {{ keywords?: string[], synonyms?: string[], title?: string }} topic
 * @returns {number}
 */
function partialOverlapScore(question, topic) {
  const qLower = String(question || '').toLowerCase().trim();
  if (!qLower) return 0;

  const qTokens = questionWords(question);
  const qSet = new Set(qTokens);
  const seen = new Set();
  let score = 0;

  const bumpToken = (t) => {
    const tok = String(t || '').toLowerCase();
    if (tok.length < 3) return;
    if (seen.has(tok)) return;
    if (qSet.has(tok) || qLower.includes(tok)) {
      seen.add(tok);
      score += 1;
    }
  };

  const scanPhrase = (phrase) => {
    const ks = String(phrase || '').toLowerCase();
    for (const t of ks.match(/[a-z0-9]+/g) || []) bumpToken(t);

    const cleaned = ks.replace(/^!/, '').trim();
    if (cleaned.length >= 4 && qLower.includes(cleaned)) {
      score += 2;
    }
  };

  for (const kw of topic.keywords || []) scanPhrase(kw);
  for (const syn of topic.synonyms || []) scanPhrase(syn);

  for (const t of String(topic.title || '')
    .toLowerCase()
    .match(/[a-z0-9]+/g) || []) {
    bumpToken(t);
  }

  return score;
}

/**
 * @param {string} question
 * @param {number} [limit=3]
 * @returns {object[]} Topic objects, best partial overlap first (no Discord I/O).
 */
function getClosestHelpTopics(question, limit = 3) {
  const topics = loadTopicsArray();
  if (!topics || !topics.length || !String(question || '').trim()) return [];

  const ranked = topics
    .map((t) => ({
      topic: t,
      score: partialOverlapScore(question, t)
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const out = [];
  for (const row of ranked) {
    if (out.length >= limit) break;
    const title = String(row.topic.title || '').trim();
    if (!title) continue;
    if (out.some((o) => String(o.title || '').trim() === title)) continue;
    out.push(row.topic);
  }

  return out.slice(0, limit);
}

/** Exposes cached topics for prompts (same load path as matching). */
function getHelpTopics() {
  return loadTopicsArray();
}

module.exports = { matchHelpTopic, getHelpTopics, getClosestHelpTopics };
