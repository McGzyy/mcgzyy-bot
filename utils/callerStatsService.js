const { getAllTrackedCalls } = require('./trackedCallsService');
const {
  parseCallerLookupInput,
  resolveCallerIdentity
} = require('./callerIdentityService');

/**
 * CONFIG
 */
const MAX_VALID_X = 500;

/**
 * HELPERS
 */

function normalize(str) {
  return (str || '').toLowerCase().trim();
}

function calculateX(firstMc, athMc) {
  if (!firstMc || !athMc || firstMc <= 0) return 1;
  return athMc / firstMc;
}

function getAth(call) {
  return Number(
    call.athMc ||
    call.ath ||
    call.athMarketCap ||
    call.latestMarketCap ||
    call.firstCalledMarketCap ||
    0
  );
}

function isValid(call) {
  const x = calculateX(call.firstCalledMarketCap, getAth(call));
  return Number.isFinite(x) && x > 0 && x <= MAX_VALID_X;
}

function getCallTimestampMs(call) {
  const raw = call?.firstCalledAt ?? call?.calledAt ?? call?.createdAt;
  if (raw == null || raw === '') return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isWithinTimeframeDays(call, days) {
  if (!Number.isFinite(days) || days <= 0) return false;
  const ms = getCallTimestampMs(call);
  if (ms == null) return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return ms >= cutoff;
}

/** Monday 00:00:00.000 UTC of the calendar week containing `from`. */
function startOfUtcWeekContaining(from) {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const d = from.getUTCDate();
  const dow = from.getUTCDay();
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  return new Date(Date.UTC(y, m, d - daysFromMonday, 0, 0, 0, 0));
}

/**
 * Previous completed UTC week (Mon 00:00 .. next Mon 00:00 exclusive), relative to `from`.
 * When `from` is Monday UTC, the range is the seven days that ended at this Monday 00:00.
 */
function getPreviousCompletedUtcWeekBounds(from = new Date()) {
  const thisWeekMonday = startOfUtcWeekContaining(from);
  const endExclusive = thisWeekMonday;
  const startInclusive = new Date(thisWeekMonday);
  startInclusive.setUTCDate(thisWeekMonday.getUTCDate() - 7);
  return { startInclusive, endExclusive };
}

function isCallTimestampInUtcMsRange(call, startMs, endExclusiveMs) {
  const ms = getCallTimestampMs(call);
  if (ms == null) return false;
  return ms >= startMs && ms < endExclusiveMs;
}

function medianSorted(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid];
  return (s[mid - 1] + s[mid]) / 2;
}

function pctAtLeast(xs, threshold) {
  if (!xs.length) return null;
  let c = 0;
  for (const x of xs) {
    if (x >= threshold) c += 1;
  }
  return (100 * c) / xs.length;
}

function cohortAthXStats(calls) {
  const xs = [];
  for (const call of calls) {
    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);
    if (Number.isFinite(x) && x > 0) xs.push(x);
  }
  const n = calls.length;
  return {
    count: n,
    medianX: medianSorted(xs),
    pctGe2: pctAtLeast(xs, 2),
    pctGe3: pctAtLeast(xs, 3)
  };
}

/**
 * Aggregate stats for the last completed UTC calendar week (no tickers).
 * Uses the same validity and user/bot filters as leaderboard helpers.
 * @param {Date} [from]
 */
function getWeeklyUtcTerminalSnapshot(from = new Date()) {
  const { startInclusive, endExclusive } = getPreviousCompletedUtcWeekBounds(from);
  const startMs = startInclusive.getTime();
  const endMs = endExclusive.getTime();

  const userCalls = getAllTrackedCalls()
    .filter(isHumanUserCall)
    .filter(isValid)
    .filter(c => isCallTimestampInUtcMsRange(c, startMs, endMs));

  const botCalls = getAllTrackedCalls()
    .filter(isBotCall)
    .filter(isValid)
    .filter(c => isCallTimestampInUtcMsRange(c, startMs, endMs));

  const seenCaller = new Set();
  for (const call of userCalls) {
    const key =
      call.firstCallerDiscordId ||
      call.firstCallerId ||
      normalize(call.firstCallerUsername) ||
      normalize(call.firstCallerDisplayName) ||
      normalize(call.firstCallerPublicName);
    if (key) seenCaller.add(String(key));
  }

  return {
    startInclusive,
    endExclusive,
    user: cohortAthXStats(userCalls),
    bot: cohortAthXStats(botCalls),
    uniqueCallers: seenCaller.size,
    totalPrints: userCalls.length + botCalls.length
  };
}

function enrichCallWithX(call) {
  const ath = getAth(call);
  const x = calculateX(call.firstCalledMarketCap, ath);
  return { ...call, x, ath };
}

function isHumanUserCall(call) {
  return (
    call &&
    call.callSourceType === 'user_call' &&
    !call.excludedFromStats &&
    call.hiddenFromDashboard !== true &&
    !['denied', 'excluded', 'expired'].includes(String(call.approvalStatus || '').toLowerCase())
  );
}

function isBotCall(call) {
  return (
    call &&
    call.callSourceType === 'bot_call' &&
    !call.excludedFromStats &&
    call.hiddenFromDashboard !== true &&
    !['denied', 'excluded', 'expired'].includes(String(call.approvalStatus || '').toLowerCase())
  );
}

function getCallerAliases(call) {
  return [
    call.firstCallerUsername,
    call.firstCallerDisplayName,
    call.firstCallerPublicName
  ]
    .filter(Boolean)
    .map(normalize);
}

function matchCaller(call, lookup, profile) {
  const lookupId = lookup.discordUserId || profile?.discordUserId || null;
  const callId = call.firstCallerDiscordId || call.firstCallerId || null;

  // Strongest match = Discord ID
  if (lookupId && callId) {
    return String(lookupId) === String(callId);
  }

  // Fallback = exact normalized alias match
  const lookupCandidates = new Set([
    normalize(lookup.raw || ''),
    normalize(lookup.username || ''),
    normalize(lookup.displayName || ''),
    normalize(profile?.username || ''),
    normalize(profile?.displayName || '')
  ]);

  const aliases = getCallerAliases(call);

  for (const candidate of lookupCandidates) {
    if (candidate && aliases.includes(candidate)) {
      return true;
    }
  }

  return false;
}

function resolveBestName(calls = []) {
  const counts = {};

  for (const call of calls) {
    const name =
      call.firstCallerPublicName ||
      call.firstCallerDisplayName ||
      call.firstCallerUsername;

    if (!name) continue;
    counts[name] = (counts[name] || 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';
}

function buildTopCalls(calls = [], limit = 5) {
  return calls
    .map(call => {
      const ath = getAth(call);
      const x = calculateX(call.firstCalledMarketCap, ath);

      return {
        tokenName: call.tokenName,
        ticker: call.ticker,
        x,
        ath,
        contractAddress: call.contractAddress,
        firstCalledMarketCap: call.firstCalledMarketCap
      };
    })
    .sort((a, b) => b.x - a.x)
    .slice(0, limit);
}

/**
 * =========================
 * HUMAN CALLER STATS
 * =========================
 */

function getCallerStats(input) {
  const lookup = parseCallerLookupInput(input);

  const profile = resolveCallerIdentity({
    discordUserId: lookup.discordUserId,
    username: lookup.username,
    displayName: lookup.displayName,
    rawInput: lookup.raw
  });

  const calls = getAllTrackedCalls()
    .filter(isHumanUserCall);

  const matched = calls.filter(call => matchCaller(call, lookup, profile));

  if (!matched.length) return null;

  const valid = matched.filter(isValid);

  let totalX = 0;
  let totalAth = 0;
  let bestCall = null;

  for (const call of valid) {
    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);

    totalX += x;
    totalAth += ath;

    if (!bestCall || x > bestCall.x) {
      bestCall = {
        tokenName: call.tokenName,
        ticker: call.ticker,
        x
      };
    }
  }

  const totalCalls = valid.length;

  return {
    username: resolveBestName(matched),
    totalCalls,
    avgX: totalCalls ? totalX / totalCalls : 0,
    avgAth: totalCalls ? totalAth / totalCalls : 0,
    bestCall,
    topCalls: buildTopCalls(valid, 5)
  };
}
function getCallerStatsRaw(input) {
  const lookup = parseCallerLookupInput(input);

  const profile = resolveCallerIdentity({
    discordUserId: lookup.discordUserId,
    username: lookup.username,
    displayName: lookup.displayName,
    rawInput: lookup.raw
  });

  const calls = getAllTrackedCalls()
    .filter(call =>
      call &&
      call.callSourceType === 'user_call' &&
      call.hiddenFromDashboard !== true &&
      !['denied', 'excluded', 'expired'].includes(String(call.approvalStatus || '').toLowerCase())
    );

  const matched = calls.filter(call => matchCaller(call, lookup, profile));

  if (!matched.length) return null;

  const valid = matched.filter(isValid);

  let totalX = 0;
  let totalAth = 0;
  let bestCall = null;

  for (const call of valid) {
    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);

    totalX += x;
    totalAth += ath;

    if (!bestCall || x > bestCall.x) {
      bestCall = {
        tokenName: call.tokenName,
        ticker: call.ticker,
        x
      };
    }
  }

  const totalCalls = valid.length;
  const resetExcludedCount = matched.filter(call => call.excludedFromStats === true).length;

  return {
    username: resolveBestName(matched),
    totalCalls,
    avgX: totalCalls ? totalX / totalCalls : 0,
    avgAth: totalCalls ? totalAth / totalCalls : 0,
    bestCall,
    topCalls: buildTopCalls(valid, 5),
    resetExcludedCount
  };
}
/**
 * =========================
 * HUMAN LEADERBOARD
 * =========================
 */

function getCallerLeaderboard(limit = 10) {
  const calls = getAllTrackedCalls()
    .filter(isHumanUserCall)
    .filter(isValid);

  const map = new Map();

  for (const call of calls) {
    const key =
      call.firstCallerDiscordId ||
      call.firstCallerId ||
      normalize(call.firstCallerUsername) ||
      normalize(call.firstCallerDisplayName) ||
      normalize(call.firstCallerPublicName);

    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        calls: [],
        totalX: 0,
        totalAth: 0
      });
    }

    const entry = map.get(key);

    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);

    entry.calls.push(call);
    entry.totalX += x;
    entry.totalAth += ath;
  }

  return [...map.values()]
    .map(entry => {
      const totalCalls = entry.calls.length;

      return {
        username: resolveBestName(entry.calls),
        totalCalls,
        avgX: totalCalls ? entry.totalX / totalCalls : 0,
        avgAth: totalCalls ? entry.totalAth / totalCalls : 0
      };
    })
    .sort((a, b) => b.avgX - a.avgX)
    .slice(0, limit);
}

/**
 * Same shape as getCallerLeaderboard but only calls inside the rolling window.
 * @param {number} days
 * @param {number} [limit]
 */
function getCallerLeaderboardInTimeframe(days, limit = 5) {
  const calls = getAllTrackedCalls()
    .filter(isHumanUserCall)
    .filter(isValid)
    .filter(call => isWithinTimeframeDays(call, days));

  const map = new Map();

  for (const call of calls) {
    const key =
      call.firstCallerDiscordId ||
      call.firstCallerId ||
      normalize(call.firstCallerUsername) ||
      normalize(call.firstCallerDisplayName) ||
      normalize(call.firstCallerPublicName);

    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        calls: [],
        totalX: 0,
        totalAth: 0
      });
    }

    const entry = map.get(key);

    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);

    entry.calls.push(call);
    entry.totalX += x;
    entry.totalAth += ath;
  }

  return [...map.values()]
    .map(entry => {
      const totalCalls = entry.calls.length;

      return {
        username: resolveBestName(entry.calls),
        totalCalls,
        avgX: totalCalls ? entry.totalX / totalCalls : 0,
        avgAth: totalCalls ? entry.totalAth / totalCalls : 0
      };
    })
    .sort((a, b) => b.avgX - a.avgX)
    .slice(0, limit);
}

/**
 * =========================
 * TIMEFRAME STATS (same filters as getCallerLeaderboard / getBotStats)
 * =========================
 */

function getBestCallInTimeframe(days) {
  const calls = getAllTrackedCalls()
    .filter(isHumanUserCall)
    .filter(isValid)
    .filter(call => isWithinTimeframeDays(call, days));

  if (!calls.length) return null;

  let best = null;
  let bestX = -Infinity;

  for (const call of calls) {
    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);
    if (x > bestX) {
      bestX = x;
      best = call;
    }
  }

  return best ? enrichCallWithX(best) : null;
}

function getTopCallerInTimeframe(days) {
  const calls = getAllTrackedCalls()
    .filter(isHumanUserCall)
    .filter(isValid)
    .filter(call => isWithinTimeframeDays(call, days));

  const map = new Map();

  for (const call of calls) {
    const key =
      call.firstCallerDiscordId ||
      call.firstCallerId ||
      normalize(call.firstCallerUsername) ||
      normalize(call.firstCallerDisplayName) ||
      normalize(call.firstCallerPublicName);

    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        calls: [],
        totalX: 0,
        totalAth: 0
      });
    }

    const entry = map.get(key);
    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);

    entry.calls.push(call);
    entry.totalX += x;
    entry.totalAth += ath;
  }

  const ranked = [...map.values()]
    .map(entry => {
      const totalCalls = entry.calls.length;
      let bestCall = null;

      for (const c of entry.calls) {
        const athC = getAth(c);
        const xC = calculateX(c.firstCalledMarketCap, athC);
        if (!bestCall || xC > bestCall.x) {
          bestCall = {
            tokenName: c.tokenName,
            ticker: c.ticker,
            x: xC
          };
        }
      }

      return {
        username: resolveBestName(entry.calls),
        totalCalls,
        avgX: totalCalls ? entry.totalX / totalCalls : 0,
        avgAth: totalCalls ? entry.totalAth / totalCalls : 0,
        bestCall
      };
    })
    .sort((a, b) => b.avgX - a.avgX);

  return ranked[0] || null;
}

function getBestBotCallInTimeframe(days) {
  const calls = getAllTrackedCalls()
    .filter(isBotCall)
    .filter(isValid)
    .filter(call => isWithinTimeframeDays(call, days));

  if (!calls.length) return null;

  let best = null;
  let bestX = -Infinity;

  for (const call of calls) {
    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);
    if (x > bestX) {
      bestX = x;
      best = call;
    }
  }

  return best ? enrichCallWithX(best) : null;
}

/**
 * =========================
 * BOT STATS
 * =========================
 */

function getBotStats() {
  const calls = getAllTrackedCalls()
    .filter(isBotCall)
    .filter(isValid);

  if (!calls.length) return null;

  let totalX = 0;
  let totalAth = 0;
  let bestCall = null;

  for (const call of calls) {
    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);

    totalX += x;
    totalAth += ath;

    if (!bestCall || x > bestCall.x) {
      bestCall = {
        tokenName: call.tokenName,
        ticker: call.ticker,
        x
      };
    }
  }

  const totalCalls = calls.length;

  return {
    username: 'Auto Bot',
    totalCalls,
    avgX: totalCalls ? totalX / totalCalls : 0,
    avgAth: totalCalls ? totalAth / totalCalls : 0,
    bestCall,
    topCalls: buildTopCalls(calls, 5)
  };
}
function getBotStatsRaw() {
  const calls = getAllTrackedCalls()
    .filter(call =>
      call &&
      call.callSourceType === 'bot_call' &&
      call.hiddenFromDashboard !== true &&
      !['denied', 'excluded', 'expired'].includes(String(call.approvalStatus || '').toLowerCase())
    )
    .filter(isValid);

  if (!calls.length) return null;

  let totalX = 0;
  let totalAth = 0;
  let bestCall = null;

  for (const call of calls) {
    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);

    totalX += x;
    totalAth += ath;

    if (!bestCall || x > bestCall.x) {
      bestCall = {
        tokenName: call.tokenName,
        ticker: call.ticker,
        x
      };
    }
  }

  const totalCalls = calls.length;
  const resetExcludedCount = calls.filter(call => call.excludedFromStats === true).length;

  return {
    username: 'Auto Bot',
    totalCalls,
    avgX: totalCalls ? totalX / totalCalls : 0,
    avgAth: totalCalls ? totalAth / totalCalls : 0,
    bestCall,
    topCalls: buildTopCalls(calls, 5),
    resetExcludedCount
  };
}

function callsForUtcWeekDesk(isDeskFn, startInclusive, endExclusive) {
  const startMs = startInclusive.getTime();
  const endMs = endExclusive.getTime();
  return getAllTrackedCalls()
    .filter(isDeskFn)
    .filter(isValid)
    .filter(c => isCallTimestampInUtcMsRange(c, startMs, endMs));
}

function getCallerLeaderboardInUtcWeekBounds(startInclusive, endExclusive, limit = 20) {
  const calls = callsForUtcWeekDesk(isHumanUserCall, startInclusive, endExclusive);
  const map = new Map();

  for (const call of calls) {
    const key =
      call.firstCallerDiscordId ||
      call.firstCallerId ||
      normalize(call.firstCallerUsername) ||
      normalize(call.firstCallerDisplayName) ||
      normalize(call.firstCallerPublicName);

    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        calls: [],
        totalX: 0,
        totalAth: 0
      });
    }

    const entry = map.get(key);
    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);

    entry.calls.push(call);
    entry.totalX += x;
    entry.totalAth += ath;
  }

  return [...map.values()]
    .map(entry => {
      const totalCalls = entry.calls.length;

      return {
        username: resolveBestName(entry.calls),
        totalCalls,
        avgX: totalCalls ? entry.totalX / totalCalls : 0,
        avgAth: totalCalls ? entry.totalAth / totalCalls : 0
      };
    })
    .sort((a, b) => b.avgX - a.avgX)
    .slice(0, limit);
}

function getBestCallInUtcWeekBounds(startInclusive, endExclusive) {
  const calls = callsForUtcWeekDesk(isHumanUserCall, startInclusive, endExclusive);
  if (!calls.length) return null;

  let best = null;
  let bestX = -Infinity;

  for (const call of calls) {
    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);
    if (x > bestX) {
      bestX = x;
      best = call;
    }
  }

  return best ? enrichCallWithX(best) : null;
}

function getBestBotCallInUtcWeekBounds(startInclusive, endExclusive) {
  const calls = callsForUtcWeekDesk(isBotCall, startInclusive, endExclusive);
  if (!calls.length) return null;

  let best = null;
  let bestX = -Infinity;

  for (const call of calls) {
    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);
    if (x > bestX) {
      bestX = x;
      best = call;
    }
  }

  return best ? enrichCallWithX(best) : null;
}

function getTopUserCallsInUtcWeekBounds(startInclusive, endExclusive, limit = 15) {
  return buildTopCalls(callsForUtcWeekDesk(isHumanUserCall, startInclusive, endExclusive), limit);
}

function getTopBotCallsInUtcWeekBounds(startInclusive, endExclusive, limit = 15) {
  return buildTopCalls(callsForUtcWeekDesk(isBotCall, startInclusive, endExclusive), limit);
}

/** Mon=0 … Sun=6 in UTC (Monday-first week index). */
function utcMondayFirstIndexFromMs(ms) {
  const dow = new Date(ms).getUTCDay();
  return dow === 0 ? 6 : dow - 1;
}

/**
 * Average ATH × per UTC weekday for calls in `[startInclusive, endExclusive)` (same filters as week desk).
 * @returns {{ memberAvg: (number|null)[], botAvg: (number|null)[] }} length 7 (Mon–Sun); `null` if no calls that day.
 */
function getAvgAthXByUtcWeekdayInBounds(startInclusive, endExclusive) {
  const memberBuckets = Array.from({ length: 7 }, () => /** @type {number[]} */ ([]));
  const botBuckets = Array.from({ length: 7 }, () => /** @type {number[]} */ ([]));

  for (const call of callsForUtcWeekDesk(isHumanUserCall, startInclusive, endExclusive)) {
    const ms = getCallTimestampMs(call);
    if (ms == null) continue;
    const idx = utcMondayFirstIndexFromMs(ms);
    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);
    if (Number.isFinite(x) && x > 0) memberBuckets[idx].push(x);
  }
  for (const call of callsForUtcWeekDesk(isBotCall, startInclusive, endExclusive)) {
    const ms = getCallTimestampMs(call);
    if (ms == null) continue;
    const idx = utcMondayFirstIndexFromMs(ms);
    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);
    if (Number.isFinite(x) && x > 0) botBuckets[idx].push(x);
  }

  const avg = (/** @type {number[][]} */ buckets) =>
    buckets.map(xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null));

  return { memberAvg: avg(memberBuckets), botAvg: avg(botBuckets) };
}

function avgXForCalls(calls) {
  if (!calls.length) return null;
  let s = 0;
  let n = 0;
  for (const call of calls) {
    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);
    if (Number.isFinite(x) && x > 0) {
      s += x;
      n += 1;
    }
  }
  return n ? s / n : null;
}

/**
 * Average ATH × per calendar month (UTC) for `yearUtc` (Jan=0 … Dec=11).
 * @param {number} yearUtc e.g. 2026
 */
function getAvgAthXByUtcMonthInYear(yearUtc) {
  const memberAvg = /** @type {(number|null)[]} */ (Array(12).fill(null));
  const botAvg = /** @type {(number|null)[]} */ (Array(12).fill(null));

  for (let m = 0; m < 12; m += 1) {
    const startInclusive = new Date(Date.UTC(yearUtc, m, 1, 0, 0, 0, 0));
    const endExclusive = new Date(Date.UTC(yearUtc, m + 1, 1, 0, 0, 0, 0));
    const startMs = startInclusive.getTime();
    const endMs = endExclusive.getTime();

    const human = getAllTrackedCalls()
      .filter(isHumanUserCall)
      .filter(isValid)
      .filter(c => isCallTimestampInUtcMsRange(c, startMs, endMs));
    const bot = getAllTrackedCalls()
      .filter(isBotCall)
      .filter(isValid)
      .filter(c => isCallTimestampInUtcMsRange(c, startMs, endMs));

    memberAvg[m] = avgXForCalls(human);
    botAvg[m] = avgXForCalls(bot);
  }

  return { year: yearUtc, memberAvg, botAvg };
}

module.exports = {
  getCallerStats,
  getCallerStatsRaw,
  getCallerLeaderboard,
  getCallerLeaderboardInTimeframe,
  getBotStats,
  getBotStatsRaw,
  getBestCallInTimeframe,
  getTopCallerInTimeframe,
  getBestBotCallInTimeframe,
  getWeeklyUtcTerminalSnapshot,
  getCallerLeaderboardInUtcWeekBounds,
  getBestCallInUtcWeekBounds,
  getBestBotCallInUtcWeekBounds,
  getTopUserCallsInUtcWeekBounds,
  getTopBotCallsInUtcWeekBounds,
  getPreviousCompletedUtcWeekBounds,
  getAvgAthXByUtcWeekdayInBounds,
  getAvgAthXByUtcMonthInYear
};