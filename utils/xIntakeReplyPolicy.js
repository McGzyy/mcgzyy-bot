/**
 * X mention intake — reply decision + copy only (no live posting).
 * Call decideXMentionIntakeReply(result, { authorHandle }) after processVerifiedXMentionCallIntake;
 * if shouldReply, pass text to xPoster.createPost later (ingestion worker — not wired here).
 */

const { X_UNVERIFIED_USER_REPLY_MESSAGE } = require('./xInteractionTrust');

/** Case A — unverified / invalid handle (only trust outcomes that imply “not verified”). */
const X_INTAKE_REPLY_UNVERIFIED = X_UNVERIFIED_USER_REPLY_MESSAGE;

function normalizeHandleForReply(raw) {
  const h = String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/[^\w]/g, '');
  return h.slice(0, 15) || 'user';
}

function sanitizeTokenNameForReply(name) {
  const s = String(name || 'Unknown')
    .replace(/@/g, '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  return s || 'Unknown';
}

/**
 * Short MC line for X (non-promotional).
 * @param {number} marketCap
 * @returns {string} e.g. "$1.2M"
 */
function formatMcForXReply(marketCap) {
  const n = Number(marketCap);
  if (!Number.isFinite(n) || n <= 0) return '$—';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

/**
 * Case B — success line: "@handle called {TOKEN} at $MC"
 * @param {string} authorHandle — X username (no @ prefix required)
 * @param {string} tokenName
 * @param {number} marketCap
 */
function buildXMentionSuccessReplyText(authorHandle, tokenName, marketCap) {
  const h = normalizeHandleForReply(authorHandle);
  const t = sanitizeTokenNameForReply(tokenName);
  const mc = formatMcForXReply(marketCap);
  return `@${h} called ${t} at ${mc}`;
}

/**
 * Strict anti-spam: reply only for (A) unverified prompt or (B) brand-new tracked row after full success.
 *
 * @param {object|null} result — processVerifiedXMentionCallIntake return value
 * @param {{ authorHandle: string }} context — same X author username used for intake
 * @returns {{
 *   shouldReply: boolean,
 *   text: string | null,
 *   case: 'unverified' | 'success' | 'silent',
 *   internalReason?: string
 * }}
 */
function decideXMentionIntakeReply(result, context = {}) {
  const authorHandle = context.authorHandle;

  if (!result || result.duplicate || result.alreadyProcessed) {
    return {
      shouldReply: false,
      text: null,
      case: 'silent',
      internalReason: 'duplicate_or_missing_result'
    };
  }

  if (result.trustDenied && result.trust && !result.trust.allowed) {
    const r = String(result.reason || result.trust.reason || '');
    if (r === 'not_verified' || r === 'invalid_handle') {
      return {
        shouldReply: true,
        text: X_INTAKE_REPLY_UNVERIFIED,
        case: 'unverified',
        internalReason: r
      };
    }
    return {
      shouldReply: false,
      text: null,
      case: 'silent',
      internalReason: `trust_${r || 'denied'}`
    };
  }

  if (!result.success) {
    return {
      shouldReply: false,
      text: null,
      case: 'silent',
      internalReason: String(result.reason || 'failure')
    };
  }

  if (result.dryRun) {
    return {
      shouldReply: false,
      text: null,
      case: 'silent',
      internalReason: 'dry_run'
    };
  }

  if (result.reason === 'tracked' && result.wasNewCall === true) {
    const tc = result.trackedCall || {};
    const mc = Number(tc.latestMarketCap ?? tc.firstCalledMarketCap ?? 0);
    const text = buildXMentionSuccessReplyText(authorHandle, tc.tokenName, mc);
    return {
      shouldReply: true,
      text,
      case: 'success',
      internalReason: 'tracked_new'
    };
  }

  return {
    shouldReply: false,
    text: null,
    case: 'silent',
    internalReason: String(result.reason || 'no_public_reply')
  };
}

module.exports = {
  X_INTAKE_REPLY_UNVERIFIED,
  decideXMentionIntakeReply,
  buildXMentionSuccessReplyText,
  formatMcForXReply,
  normalizeHandleForReply,
  sanitizeTokenNameForReply
};
