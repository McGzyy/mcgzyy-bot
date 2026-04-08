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

function isHumanUserCall(call) {
  return (
    call &&
    call.callSourceType === 'user_call' &&
    !call.excludedFromStats &&
    !['denied', 'excluded', 'expired'].includes(String(call.approvalStatus || '').toLowerCase())
  );
}

function isBotCall(call) {
  return (
    call &&
    call.callSourceType === 'bot_call' &&
    !call.excludedFromStats &&
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

function callerMatchesDiscordId(call, discordUserId) {
  const uid = discordUserId != null ? String(discordUserId).trim() : '';
  if (!uid) return false;
  const cid = String(call.firstCallerDiscordId || call.firstCallerId || '').trim();
  return cid === uid;
}

function medianSorted(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2) return s[mid];
  return (s[mid - 1] + s[mid]) / 2;
}

/** Draft v1 thresholds for mod-facing Top Caller eligibility (not enforced automatically). */
const TOP_CALLER_ELIGIBILITY = {
  minValidCalls: 10,
  minAvgX: 2.0,
  noLineAvgX: 1.4,
  minCallsNoLine: 5
};

/**
 * Read-only: evaluate a user using Discord-ID-linked `user_call` rows only (no alias fallback).
 * @param {string} discordUserId
 * @returns {object|null}
 */
function getTopCallerEligibilityReport(discordUserId) {
  const uid = discordUserId != null ? String(discordUserId).trim() : '';
  if (!uid) return null;

  const allTracked = getAllTrackedCalls();
  const idLinked = allTracked.filter(
    c => c && c.callSourceType === 'user_call' && callerMatchesDiscordId(c, uid)
  );

  const excludedFromStatsCount = idLinked.filter(c => c.excludedFromStats === true).length;
  const badApprovalStatuses = new Set(['denied', 'excluded', 'expired']);
  const blockedByApprovalCount = idLinked.filter(c =>
    badApprovalStatuses.has(String(c.approvalStatus || '').toLowerCase())
  ).length;

  const eligiblePool = idLinked.filter(
    c =>
      !c.excludedFromStats &&
      !badApprovalStatuses.has(String(c.approvalStatus || '').toLowerCase())
  );

  const valid = eligiblePool.filter(isValid);
  const xs = valid.map(c => calculateX(c.firstCalledMarketCap, getAth(c)));

  let totalX = 0;
  let bestX = 0;
  let bestToken = '';
  for (let i = 0; i < valid.length; i++) {
    const x = xs[i];
    totalX += x;
    if (x > bestX) {
      bestX = x;
      bestToken = `${valid[i].tokenName || 'Unknown'} ($${valid[i].ticker || '—'})`;
    }
  }

  const validCount = valid.length;
  const avgX = validCount ? totalX / validCount : 0;
  const medianX = medianSorted(xs);
  const top3 = buildTopCalls(valid, 3);

  const lookup = {
    raw: '',
    discordUserId: uid,
    username: '',
    displayName: ''
  };
  const profile = resolveCallerIdentity({
    discordUserId: uid,
    username: '',
    displayName: '',
    rawInput: ''
  });
  const legacyMatched = allTracked.filter(
    c => c && c.callSourceType === 'user_call' && matchCaller(c, lookup, profile)
  );
  const legacyMoreThanIdOnly = legacyMatched.length > idLinked.length;

  let eligibility = 'BORDERLINE';
  const reasons = [];

  const { minValidCalls, minAvgX, noLineAvgX, minCallsNoLine } = TOP_CALLER_ELIGIBILITY;

  if (validCount >= minValidCalls && avgX >= minAvgX) {
    eligibility = 'YES';
    reasons.push(`Meets minimum valid calls (${minValidCalls}+) and average X (≥${minAvgX}x).`);
  } else if (validCount < minCallsNoLine || avgX < noLineAvgX) {
    eligibility = 'NO';
    if (validCount < minCallsNoLine) reasons.push(`Below minimum sample for a clear read (${minCallsNoLine}+ valid calls).`);
    if (avgX < noLineAvgX) reasons.push(`Average X below conservative floor (need ≥${noLineAvgX}x at this stage).`);
  } else {
    eligibility = 'BORDERLINE';
    if (validCount < minValidCalls) reasons.push(`Valid calls ${validCount} — under ${minValidCalls} target.`);
    if (avgX < minAvgX) reasons.push(`Average X ${avgX.toFixed(2)}x — under ${minAvgX}x target.`);
    if (bestX >= minAvgX * 2) reasons.push('Best call is strong; sample or average still catching up.');
  }

  if (legacyMoreThanIdOnly) {
    reasons.push(
      '**Caveat:** extra user_call rows match via username/display legacy paths but not Discord ID on row — not counted here.'
    );
  }

  if (validCount === 0 && idLinked.length === 0) {
    reasons.push('No user_call rows with this Discord ID as first caller.');
  }

  return {
    discordUserId: uid,
    validCallCount: validCount,
    avgX,
    medianX,
    bestX,
    bestToken,
    top3,
    excludedFromStatsCount,
    blockedByApprovalCount,
    idLinkedCallCount: idLinked.length,
    legacyMoreThanIdOnly,
    eligibility,
    reasons,
    thresholds: { ...TOP_CALLER_ELIGIBILITY }
  };
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
    username: 'McGBot',
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
    username: 'McGBot',
    totalCalls,
    avgX: totalCalls ? totalX / totalCalls : 0,
    avgAth: totalCalls ? totalAth / totalCalls : 0,
    bestCall,
    topCalls: buildTopCalls(calls, 5),
    resetExcludedCount
  };
}

/**
 * =========================
 * TIMEFRAME STATS (V1)
 * =========================
 */

function getCallTimeMs(call) {
  const t =
    call?.calledAt ||
    call?.firstCalledAt ||
    call?.createdAt ||
    call?.lastUpdatedAt ||
    0;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function filterCallsInLastNDays(calls, days) {
  const d = Number(days);
  const daysSafe = Number.isFinite(d) && d > 0 ? d : 1;
  const since = Date.now() - daysSafe * 24 * 60 * 60 * 1000;
  return calls.filter(c => getCallTimeMs(c) >= since);
}

function getBestCallInTimeframe(days = 1) {
  const pool = filterCallsInLastNDays(
    getAllTrackedCalls().filter(isHumanUserCall).filter(isValid),
    days
  );
  if (!pool.length) return null;

  let best = null;
  let bestX = 0;

  for (const call of pool) {
    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);
    if (!best || x > bestX) {
      best = call;
      bestX = x;
    }
  }

  if (!best) return null;
  return {
    tokenName: best.tokenName,
    ticker: best.ticker,
    x: bestX,
    ath: getAth(best),
    contractAddress: best.contractAddress,
    firstCalledMarketCap: best.firstCalledMarketCap,

    firstCallerUsername: best.firstCallerUsername,
    firstCallerDisplayName: best.firstCallerDisplayName,
    firstCallerPublicName: best.firstCallerPublicName
  };
}

function getBestBotCallInTimeframe(days = 1) {
  const pool = filterCallsInLastNDays(
    getAllTrackedCalls().filter(isBotCall).filter(isValid),
    days
  );
  if (!pool.length) return null;

  let best = null;
  let bestX = 0;

  for (const call of pool) {
    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);
    if (!best || x > bestX) {
      best = call;
      bestX = x;
    }
  }

  if (!best) return null;
  return {
    tokenName: best.tokenName,
    ticker: best.ticker,
    x: bestX,
    ath: getAth(best),
    contractAddress: best.contractAddress,
    firstCalledMarketCap: best.firstCalledMarketCap,

    firstCallerUsername: best.firstCallerUsername,
    firstCallerDisplayName: best.firstCallerDisplayName,
    firstCallerPublicName: best.firstCallerPublicName
  };
}

function getTopCallerInTimeframe(days = 1) {
  const pool = filterCallsInLastNDays(
    getAllTrackedCalls().filter(isHumanUserCall).filter(isValid),
    days
  );
  if (!pool.length) return null;

  const map = new Map();

  for (const call of pool) {
    const key =
      call.firstCallerDiscordId ||
      call.firstCallerId ||
      normalize(call.firstCallerUsername) ||
      normalize(call.firstCallerDisplayName) ||
      normalize(call.firstCallerPublicName);
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, { calls: [], totalX: 0, totalAth: 0 });
    }

    const entry = map.get(key);
    const ath = getAth(call);
    const x = calculateX(call.firstCalledMarketCap, ath);
    entry.calls.push(call);
    entry.totalX += x;
    entry.totalAth += ath;
  }

  let best = null;
  for (const entry of map.values()) {
    const totalCalls = entry.calls.length;
    const avgX = totalCalls ? entry.totalX / totalCalls : 0;
    if (!best || avgX > best.avgX) {
      best = { ...entry, totalCalls, avgX };
    }
  }

  if (!best) return null;

  const totalCalls = best.totalCalls;
  const avgX = best.avgX;
  const avgAth = totalCalls ? best.totalAth / totalCalls : 0;

  let bestCall = null;
  let bestX = 0;
  for (const call of best.calls) {
    const x = calculateX(call.firstCalledMarketCap, getAth(call));
    if (!bestCall || x > bestX) {
      bestCall = call;
      bestX = x;
    }
  }

  return {
    username: resolveBestName(best.calls),
    totalCalls,
    avgX,
    avgAth,
    bestCall: bestCall
      ? {
          tokenName: bestCall.tokenName,
          ticker: bestCall.ticker,
          x: bestX
        }
      : null
  };
}

module.exports = {
  getCallerStats,
  getCallerStatsRaw,
  getCallerLeaderboard,
  getBotStats,
  getBotStatsRaw,
  getTopCallerInTimeframe,
  getBestCallInTimeframe,
  getBestBotCallInTimeframe,
  getTopCallerEligibilityReport,
  TOP_CALLER_ELIGIBILITY
};