/**
 * Structured, terminal-friendly logging for the X mention ingestion pipeline.
 *
 * Env:
 *   X_LOG_VERBOSE=1|true|yes — log full tweet text; otherwise truncate (~200 chars, one line).
 */

function truthyEnv(name) {
  return /^1|true|yes$/i.test(String(process.env[name] || '').trim());
}

function isXLogVerbose() {
  return truthyEnv('X_LOG_VERBOSE');
}

const TEXT_MAX = 200;

function formatTweetTextLine(text) {
  const s = String(text || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!isXLogVerbose() && s.length > TEXT_MAX) {
    return `${s.slice(0, TEXT_MAX - 1)}…`;
  }
  return s;
}

/**
 * @param {object|null|undefined} result — processVerifiedXMentionCallIntake return
 * @returns {{ hasCA: string, extractedCA: string, procReason: string }}
 */
function computeXProcessing(result) {
  if (!result) {
    return { hasCA: 'false', extractedCA: '', procReason: 'invalid_candidate' };
  }

  const r = String(result.reason || '');
  const ca = result.contractAddress != null ? String(result.contractAddress).trim() : '';

  if (r === 'no_solana_ca_in_text') {
    return { hasCA: 'false', extractedCA: '', procReason: 'no_solana_ca_in_text' };
  }

  if (r === 'invalid_solana_ca') {
    return { hasCA: 'true', extractedCA: ca, procReason: 'invalid_format' };
  }

  if (r === 'no_explicit_call_hashtag') {
    return { hasCA: ca ? 'true' : 'false', extractedCA: ca || '', procReason: 'no_explicit_call_hashtag' };
  }

  if (ca) {
    return { hasCA: 'true', extractedCA: ca, procReason: '' };
  }

  return { hasCA: 'false', extractedCA: '', procReason: normalizeProcessingReason(result) };
}

function normalizeProcessingReason(result) {
  const r = String(result.reason || '');
  const map = {
    already_processed: 'duplicate'
  };
  if (map[r]) return map[r];
  if (result.trustDenied) {
    const tr = String(result.reason || '');
    if (tr === 'not_verified' || tr === 'invalid_handle') return 'trust_denied';
    return tr || 'trust_denied';
  }
  if (result.guildTrustDenied) {
    return r || 'guild_denied';
  }
  return r || 'unknown';
}

function normalizeFailureReason(r) {
  const s = String(r || '');
  if (s === 'invalid_solana_ca') return 'invalid_format';
  if (s === 'already_processed') return 'duplicate';
  return s;
}

/**
 * @param {{ result: object|null, plan: object|null|undefined, replyOutcome: object|undefined }} args
 * @returns {{ action: string, reason: string }}
 */
function computeXDecision({ result, plan, replyOutcome }) {
  const ro = replyOutcome || {};

  if (ro.attempted === true && ro.out) {
    const o = ro.out;
    if (o.success && o.id) {
      return { action: 'replied', reason: 'posted' };
    }
    if (o.success && o.dryRun) {
      return { action: 'replied', reason: 'x_post_dry_run' };
    }
    if (!o.success) {
      return { action: 'rejected', reason: 'x_post_failed' };
    }
  }

  if (plan && plan.shouldReply && ro.suppressed) {
    return { action: 'queued', reason: 'reply_env_disabled' };
  }

  if (!result) {
    return { action: 'rejected', reason: 'invalid_candidate' };
  }

  if (result.duplicate || result.alreadyProcessed) {
    return { action: 'ignored', reason: 'duplicate' };
  }

  if (result.success && (result.dryRun || result.reason === 'tracked')) {
    const dr = String(result.reason || '');
    if (dr === 'dry_run_full') return { action: 'scanned', reason: 'dry_run_full' };
    if (dr === 'dry_run_trust_and_ca_ok') return { action: 'scanned', reason: 'dry_run_trust_and_ca_ok' };
    if (dr === 'tracked') return { action: 'scanned', reason: 'tracked' };
    return { action: 'scanned', reason: dr || 'intake_success' };
  }

  if (result.trustDenied) {
    const tr = String(result.reason || '');
    if (tr === 'not_verified' || tr === 'invalid_handle') {
      return { action: 'rejected', reason: 'trust_denied' };
    }
    return { action: 'rejected', reason: tr || 'trust_denied' };
  }

  if (result.guildTrustDenied) {
    return { action: 'rejected', reason: String(result.reason || 'guild_denied') };
  }

  if (result.reason === 'no_explicit_call_hashtag') {
    return { action: 'ignored', reason: 'no_explicit_call_hashtag' };
  }

  if (result.reason === 'no_solana_ca_in_text') {
    return { action: 'ignored', reason: 'no_solana_ca_in_text' };
  }

  if (!result.success) {
    return { action: 'rejected', reason: normalizeFailureReason(result.reason) };
  }

  return { action: 'ignored', reason: String(plan?.internalReason || 'unknown') };
}

function shouldSuppressXMentionActivityLog(decision) {
  if (decision.action === 'ignored' && decision.reason === 'no_solana_ca_in_text') return true;
  if (decision.action === 'ignored' && decision.reason === 'duplicate') return true;
  return false;
}

/**
 * Emit [XActivity] / [XProcessing] / [XDecision] as a single grouped burst.
 * @param {{ authorHandle?: string, tweetText?: string, tweetId?: string }} candidate
 * @param {object|null} result
 * @param {object|null|undefined} plan
 * @param {object|undefined} replyOutcome
 */
function emitXMentionStructuredLog(candidate, result, plan, replyOutcome) {
  const decision = computeXDecision({ result, plan, replyOutcome });
  if (shouldSuppressXMentionActivityLog(decision)) {
    return;
  }

  const tweetId = candidate?.tweetId != null ? String(candidate.tweetId) : 'n/a';
  const authorHandle = candidate?.authorHandle != null ? String(candidate.authorHandle) : 'n/a';
  const ts = new Date().toISOString();
  const textLine = formatTweetTextLine(candidate?.tweetText);

  console.log(
    `[XActivity] tweetId=${tweetId} author=${authorHandle} text=${JSON.stringify(
      textLine
    )} timestamp=${ts}`
  );

  const proc = computeXProcessing(result);
  let procLine = `[XProcessing] hasCA=${proc.hasCA} extractedCA=${proc.extractedCA || 'none'}`;
  if (proc.procReason) procLine += ` reason=${proc.procReason}`;
  console.log(procLine);

  console.log(`[XDecision] action=${decision.action} reason=${decision.reason}`);
}

module.exports = {
  isXLogVerbose,
  computeXProcessing,
  computeXDecision,
  emitXMentionStructuredLog,
  shouldSuppressXMentionActivityLog
};
