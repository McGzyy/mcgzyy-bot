'use strict';

const { fetchTweetPublicMetrics } = require('./xPoster');

function parseEnvFloat(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function quoteAgeHours(metrics, postedAtIso) {
  if (metrics?.createdAt) {
    const t = new Date(metrics.createdAt).getTime();
    if (Number.isFinite(t) && t > 0) {
      return (Date.now() - t) / (60 * 60 * 1000);
    }
  }
  if (postedAtIso) {
    const t = new Date(postedAtIso).getTime();
    if (Number.isFinite(t) && t > 0) {
      return (Date.now() - t) / (60 * 60 * 1000);
    }
  }
  return 0;
}

/**
 * Keep the active quote on X (and post an additional new quote) when it has been up long
 * enough AND engagement clears thresholds. Otherwise replace (delete after new post succeeds).
 *
 * @param {string} quoteTweetId
 * @param {string|null|undefined} postedAtIso
 * @returns {Promise<{ keep: boolean, reason: string, ageHours?: number, likes?: number, retweets?: number }>}
 */
async function shouldKeepActiveQuote(quoteTweetId, postedAtIso) {
  const minAgeH = parseEnvFloat('X_MILESTONE_QUOTE_KEEP_MIN_AGE_HOURS', 4);
  const minLikes = parseEnvFloat('X_MILESTONE_QUOTE_KEEP_MIN_LIKES', 10);
  const minRts = parseEnvFloat('X_MILESTONE_QUOTE_KEEP_MIN_RETWEETS', 2);

  const metrics = await fetchTweetPublicMetrics(quoteTweetId);
  const ageHours = quoteAgeHours(metrics, postedAtIso);

  if (ageHours < minAgeH) {
    return {
      keep: false,
      reason: 'too_young',
      ageHours,
      likes: metrics?.likes ?? 0,
      retweets: metrics?.retweets ?? 0
    };
  }

  const likes = metrics?.likes ?? 0;
  const retweets = metrics?.retweets ?? 0;
  const hot = likes >= minLikes || retweets >= minRts;

  return {
    keep: hot,
    reason: hot ? 'high_engagement' : 'low_engagement',
    ageHours,
    likes,
    retweets
  };
}

module.exports = {
  shouldKeepActiveQuote
};
