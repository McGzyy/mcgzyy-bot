/**
 * Shared X milestone post copy — approval path (mod Approve) vs monitor auto-post path.
 * Same visual structure; tweak via X_POST_COPY below (separators, × vs x, CA trim, footer).
 *
 * Future: pass opts.extraTailLines (string[]) for chart links, Discord URLs, etc. — inserted before footer.
 */

const { resolvePublicCallerName } = require('./userProfileService');

/**
 * Easy knobs — adjust without touching layout logic.
 * @type {{
 *   multiplyChar: string,
 *   footerBrand: string,
 *   caTruncateHead: number,
 *   caTruncateTail: number,
 *   replyCaHint: string
 * }}
 */
const X_POST_COPY = {
  multiplyChar: '×',
  footerBrand: 'MCGZYY',
  caTruncateHead: 4,
  caTruncateTail: 4,
  replyCaHint: 'See thread for contract'
};

function formatCompactUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return `$${Math.round(n)}`;
}

/** @deprecated Prefer formatCompactUsd for display; kept for callers expecting a string. */
function formatAthMc(trackedCall) {
  return formatCompactUsd(
    trackedCall.ath ||
      trackedCall.athMc ||
      trackedCall.athMarketCap ||
      trackedCall.latestMarketCap ||
      trackedCall.firstCalledMarketCap ||
      0
  );
}

function formatMilestoneMultiple(milestoneX) {
  const n = Number(milestoneX);
  const ch = X_POST_COPY.multiplyChar;
  if (!Number.isFinite(n) || n <= 0) return `?${ch}`;
  const rounded = Math.round(n * 10) / 10;
  const s = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(/\.0$/, '');
  return `${s}${ch}`;
}

function shortenCa(ca, head = X_POST_COPY.caTruncateHead, tail = X_POST_COPY.caTruncateTail) {
  const s = String(ca || '').trim();
  if (!s) return '—';
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function headlinePair(trackedCall) {
  const name = (trackedCall.tokenName || trackedCall.ticker || 'Token').trim() || 'Token';
  let ticker = String(trackedCall.ticker || 'UNKNOWN').trim();
  if (!ticker.startsWith('$')) {
    ticker = `$${ticker}`;
  }
  return { name, ticker };
}

/**
 * One-line headline: name, ticker, multiple — no hype.
 * Replies use "now" before the multiple for a light update signal.
 */
function buildHeadline(trackedCall, milestoneX, isReply = false) {
  const { name, ticker } = headlinePair(trackedCall);
  const mult = formatMilestoneMultiple(milestoneX);
  const multPart = isReply ? `now ${mult}` : mult;
  const tickPlain = ticker.replace(/^\$/, '').toUpperCase();
  const nameUpper = name.toUpperCase();
  const sep = ' · ';
  if (nameUpper === tickPlain || name === ticker) {
    return `${ticker}${sep}${multPart}`;
  }
  return `${name} (${ticker})${sep}${multPart}`;
}

/**
 * Caller credit: prefer @handle when resolvePublicCallerName returns it (verified_x_tag path).
 */
function formatCallerLine(creditRaw) {
  const s = String(creditRaw == null ? '' : creditRaw)
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || /^no caller credit$/i.test(s)) return '';
  if (s.startsWith('@')) return `By ${s}`;
  if (s === 'McGBot') return 'By McGBot';
  return `By ${s.slice(0, 80)}`;
}

function athSourceMc(trackedCall) {
  return (
    trackedCall.ath ||
    trackedCall.athMc ||
    trackedCall.athMarketCap ||
    trackedCall.latestMarketCap ||
    trackedCall.firstCalledMarketCap ||
    0
  );
}

/** Entry MC at call time — for "Called …" on first milestone posts. */
function calledSourceMc(trackedCall) {
  const n = Number(
    trackedCall.firstCalledMarketCap ?? trackedCall.marketCapAtCall ?? trackedCall.marketCap ?? 0
  );
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * First posts: `Called $X → ATH $Y` when call MC exists; else `ATH $Y` only.
 * Replies: single `ATH $Y` (compact).
 */
function buildMarketCapLine(trackedCall, isReply) {
  const athVal = athSourceMc(trackedCall);
  const ath = formatCompactUsd(athVal);
  if (isReply) {
    return `ATH ${ath}`;
  }
  const called = calledSourceMc(trackedCall);
  if (called != null) {
    return `Called ${formatCompactUsd(called)} → ATH ${ath}`;
  }
  return `ATH ${ath}`;
}

/**
 * Single credit resolver for milestone X posts (approval + monitor builders).
 * Uses resolvePublicCallerName for verified_x_tag / discord_name / anonymous.
 */
function resolveMilestonePostCallerCredit(trackedCall, fallback = 'Unknown') {
  if (!trackedCall) return fallback;

  if (trackedCall.callSourceType === 'bot_call') {
    return 'McGBot';
  }

  if (trackedCall.callSourceType === 'watch_only') {
    return (
      trackedCall.firstCallerPublicName ||
      trackedCall.firstCallerDisplayName ||
      trackedCall.firstCallerUsername ||
      fallback
    );
  }

  return resolvePublicCallerName({
    discordUserId: trackedCall.firstCallerDiscordId || trackedCall.firstCallerId || null,
    username: trackedCall.firstCallerUsername || '',
    displayName: trackedCall.firstCallerDisplayName || '',
    trackedCall,
    fallback:
      trackedCall.firstCallerPublicName ||
      trackedCall.firstCallerDisplayName ||
      trackedCall.firstCallerUsername ||
      fallback
  });
}

function resolveCallerApproval(trackedCall) {
  return resolveMilestonePostCallerCredit(trackedCall, 'Unknown');
}

function resolveCallerMonitor(trackedCall, fallback = 'Unknown') {
  return resolveMilestonePostCallerCredit(trackedCall, fallback);
}

/**
 * @param {'approval'|'monitor'} variant — reserved for future tone tweaks (layout identical today)
 * @param {{ omitCallerOnReply?: boolean, extraTailLines?: string[] }} opts
 */
function buildMilestoneXBody(trackedCall, milestoneX, isReply, _variant, creditRaw, opts = {}) {
  const { omitCallerOnReply = false, extraTailLines = [] } = opts;
  const headline = buildHeadline(trackedCall, milestoneX, isReply);
  const mcLine = buildMarketCapLine(trackedCall, isReply);
  const ca = String(trackedCall.contractAddress || '').trim();
  const caDisplay = shortenCa(ca);
  const callerLine = formatCallerLine(creditRaw);
  const footer = X_POST_COPY.footerBrand;

  const extras = Array.isArray(extraTailLines)
    ? extraTailLines.map(l => String(l || '').trim()).filter(Boolean)
    : [];

  const lines = [];

  if (!isReply) {
    lines.push(headline);
    if (callerLine) lines.push(callerLine);
    lines.push('');
    lines.push(mcLine);
    lines.push(`CA ${caDisplay}`);
    for (const x of extras) lines.push(x);
    lines.push('');
    lines.push(footer);
  } else {
    lines.push(headline);
    if (!omitCallerOnReply && callerLine) lines.push(callerLine);
    lines.push('');
    lines.push(mcLine);
    lines.push(X_POST_COPY.replyCaHint);
    for (const x of extras) lines.push(x);
    lines.push('');
    lines.push(footer);
  }

  return lines.join('\n');
}

/**
 * Mod-approval first post + replies (index.js).
 * @param {{ extraTailLines?: string[] }} [options] — optional lines before footer (e.g. chart URL, Discord link).
 */
function buildXPostTextApproval(trackedCall, milestoneX, isReply = false, options = {}) {
  const credit = resolveCallerApproval(trackedCall);
  return buildMilestoneXBody(trackedCall, milestoneX, isReply, 'approval', credit, {
    omitCallerOnReply: true,
    extraTailLines: Array.isArray(options.extraTailLines) ? options.extraTailLines : []
  });
}

/**
 * Monitor loop milestone posts (user + bot calls once xApproved).
 * @param {{ extraTailLines?: string[] }} [options]
 */
function buildXPostTextMonitor(trackedCall, milestoneX, isReply = false, options = {}) {
  const credit = resolveCallerMonitor(trackedCall, 'Unknown');
  return buildMilestoneXBody(trackedCall, milestoneX, isReply, 'monitor', credit, {
    omitCallerOnReply: true,
    extraTailLines: Array.isArray(options.extraTailLines) ? options.extraTailLines : []
  });
}

module.exports = {
  X_POST_COPY,
  buildXPostTextApproval,
  buildXPostTextMonitor,
  resolveMilestonePostCallerCredit,
  resolveCallerApproval,
  resolveCallerMonitor,
  formatAthMc,
  formatCompactUsd,
  buildHeadline,
  buildMarketCapLine
};
