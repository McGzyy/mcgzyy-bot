'use strict';

const { postWeeklyRunnerToX, postMonthlyTopCallerToX } = require('./xEngagementPosts');

/** @type {import('discord.js').Client | null} */
let discordClient = null;

/**
 * @param {import('discord.js').Client | null} client
 */
function setXEngagementDiscordClient(client) {
  discordClient = client;
}

function digestHourFallback() {
  const n = Number(process.env.X_LEADERBOARD_DIGEST_UTC_HOUR ?? 16);
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : 16;
}

function monthlyTopCallerHour() {
  const raw = process.env.X_MONTHLY_TOP_CALLER_UTC_HOUR;
  if (raw != null && String(raw).trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 23) return n;
  }
  return digestHourFallback();
}

function weeklyRunnerHour() {
  const raw = process.env.X_WEEKLY_RUNNER_UTC_HOUR;
  if (raw != null && String(raw).trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 23) return n;
  }
  return digestHourFallback();
}

async function tickXEngagementPosts() {
  const now = new Date();
  const hour = now.getUTCHours();
  const minute = now.getUTCMinutes();
  const wday = now.getUTCDay();
  const dom = now.getUTCDate();

  if (minute > 12) {
    return;
  }

  const runnerDay = Number(process.env.X_WEEKLY_RUNNER_UTC_WEEKDAY ?? 2);
  const runnerHour = weeklyRunnerHour();
  if (wday === runnerDay && hour === runnerHour) {
    try {
      await postWeeklyRunnerToX();
    } catch (e) {
      console.error('[XEngagement] weekly runner:', e?.message || e);
    }
  }

  const monthlyHour = monthlyTopCallerHour();
  if (dom === 1 && hour === monthlyHour) {
    try {
      await postMonthlyTopCallerToX(discordClient);
    } catch (e) {
      console.error('[XEngagement] monthly top caller:', e?.message || e);
    }
  }
}

module.exports = {
  setXEngagementDiscordClient,
  tickXEngagementPosts
};
