/**
 * Live X mention ingestion — **disabled by default**.
 *
 * Env:
 *   X_MENTION_INGESTION_ENABLED=1|true|yes  — start interval runner.
 *   X_MENTION_POLL_INTERVAL_MS=<ms>           — min 15000, default 300000 (5 min). Not aggressive polling.
 *   X_MENTION_POST_REPLIES=1|true|yes         — if set, may call createPost for reply policy outcomes (still obeys X_POST_DRY_RUN / API creds).
 *   DISCORD_GUILD_ID / X_INTAKE_GUILD_ID      — guild for intake membership checks (same as intake).
 *   X API user-context creds (same as posting): X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
 *   Optional: X_BOT_USER_ID (skip GET /2/users/me), X_MENTION_FETCH_MAX (5–100, default 10)
 *   X_LOG_VERBOSE=1|true|yes — full tweet text in [XActivity] lines (utils/xActivityLog.js)
 *
 * Layers:
 *   1) fetchXMentionCandidates() — X API v2 GET /2/users/:id/mentions (see xMentionFetch.js); override via setXMentionCandidateProvider().
 *   2) processSingleCandidate() — processVerifiedXMentionCallIntake + logging.
 *   3) maybePostIntakeReply() — decideXMentionIntakeReply + gated createPost(reply).
 */

const { processVerifiedXMentionCallIntake, decideXMentionIntakeReply } = require('./xCallIntakeService');
const { createPost } = require('./xPoster');
const { resolveIntakeGuild } = require('./xIntakeGuildTrust');
const {
  fetchXMentionCandidatesFromApi,
  hasUserContextCredentials
} = require('./xMentionFetch');
const { emitXMentionStructuredLog } = require('./xActivityLog');

function truthyEnv(name) {
  return /^1|true|yes$/i.test(String(process.env[name] || '').trim());
}

function isXMentionIngestionEnabled() {
  return truthyEnv('X_MENTION_INGESTION_ENABLED');
}

function isXMentionReplyPostingEnabled() {
  return truthyEnv('X_MENTION_POST_REPLIES');
}

function pollIntervalMs() {
  const raw = process.env.X_MENTION_POLL_INTERVAL_MS;
  const fallback = 300000;
  const n =
    raw != null && String(raw).trim() !== ''
      ? Number(String(raw).trim())
      : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(15000, Math.floor(n));
}

/**
 * @typedef {{ authorHandle: string, tweetText: string, tweetId: string, replyToTweetId?: string }} XMentionCandidate
 */

/** No-op source — use setXMentionCandidateProvider(() => []) to force-disable API fetches. */
async function fetchXMentionCandidatesStub() {
  return [];
}

let candidateProvider = fetchXMentionCandidatesFromApi;

/**
 * @param {() => Promise<XMentionCandidate[]>} fn
 */
function setXMentionCandidateProvider(fn) {
  candidateProvider = typeof fn === 'function' ? fn : fetchXMentionCandidatesStub;
}

async function fetchXMentionCandidates() {
  const out = await candidateProvider();
  return Array.isArray(out) ? out : [];
}

function resolveDefaultGuild(client) {
  return resolveIntakeGuild(client, null);
}

/**
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild|null} guild
 * @param {XMentionCandidate} candidate
 * @param {{ dryRun?: boolean }} [options] — live tick uses dryRun false (default)
 */
async function processSingleCandidate(client, guild, candidate, options = {}) {
  const dryRun = options.dryRun === true;
  const { authorHandle, tweetText, tweetId, replyToTweetId } = candidate;
  if (!authorHandle || !tweetText || !tweetId) {
    console.warn('[XMentionIngest] Skip candidate — missing authorHandle, tweetText, or tweetId');
    return null;
  }

  const result = await processVerifiedXMentionCallIntake(
    { authorHandle, tweetText, tweetId },
    { client, guild, dryRun }
  );

  const plan = decideXMentionIntakeReply(result, { authorHandle });
  const targetReplyId = replyToTweetId || tweetId;

  return { result, plan, targetReplyId, dryRun };
}

/**
 * Manual / dev injection — same pipeline as the interval tick (optionally dry-run intake).
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild|null} guild
 * @param {XMentionCandidate} candidate
 * @param {{ dryRun?: boolean, attemptReplyAfterIntake?: boolean }} [options]
 *        attemptReplyAfterIntake: if true and dryRun false, runs maybePostIntakeReply (still gated by X_MENTION_POST_REPLIES + X dry-run).
 */
async function runInjectedMentionOnce(client, guild, candidate, options = {}) {
  const dryRun = options.dryRun !== false;
  const attemptReplyAfterIntake = options.attemptReplyAfterIntake === true;

  const bundle = await processSingleCandidate(client, guild, candidate, { dryRun });
  if (!bundle) {
    emitXMentionStructuredLog(candidate, null, null, { attempted: false });
    return { ok: false, error: 'invalid_candidate' };
  }

  let replyOutcome;

  if (attemptReplyAfterIntake && !dryRun) {
    replyOutcome = await maybePostIntakeReply({
      plan: bundle.plan,
      targetReplyId: bundle.targetReplyId
    });
    emitXMentionStructuredLog(candidate, bundle.result, bundle.plan, replyOutcome);
  } else {
    replyOutcome = {
      attempted: false,
      reason: dryRun ? 'dry_run_intake' : 'reply_step_not_requested',
      policyShouldReply: bundle.plan.shouldReply,
      policyCase: bundle.plan.case,
      policyText: bundle.plan.text || null,
      targetReplyId: bundle.targetReplyId,
      xMentionPostRepliesEnv: isXMentionReplyPostingEnabled(),
      note: dryRun
        ? 'Intake dry-run: no tracked-call write; dedupe id not recorded for new applies. Reply step not executed.'
        : 'Reply step was not requested (unexpected for inject helper).'
    };
    if (dryRun && bundle.plan.shouldReply) {
      replyOutcome.note +=
        ' Policy may still want a reply on full apply (e.g. unverified / tracked + new case).';
    }
    emitXMentionStructuredLog(candidate, bundle.result, bundle.plan, replyOutcome);
  }

  if (bundle.result?.reason !== 'no_explicit_call_hashtag') {
    console.log('[XMentionIngest][inject]', {
      tweetId: candidate.tweetId,
      dryRun,
      attemptReplyAfterIntake,
      intakeReason: bundle.result.reason,
      replyCase: bundle.plan.case,
      policyShouldReply: bundle.plan.shouldReply,
      replyAttempted: replyOutcome.attempted === true
    });
  }

  return { ok: true, bundle, replyOutcome };
}

/**
 * @param {{ plan: object, targetReplyId: string }} args
 */
async function maybePostIntakeReply({ plan, targetReplyId }) {
  if (!plan?.shouldReply || !plan.text || !targetReplyId) {
    return { attempted: false, reason: 'no_reply_plan' };
  }

  if (!isXMentionReplyPostingEnabled()) {
    console.log(
      '[XMentionIngest] Reply held (set X_MENTION_POST_REPLIES=1 to allow):',
      plan.case,
      plan.text?.slice(0, 120)
    );
    return { attempted: false, suppressed: true, reason: 'env_gate' };
  }

  const out = await createPost(plan.text, targetReplyId);
  const posted = !!(out.success && out.id);
  console.log('[XMentionIngest] createPost reply:', {
    posted,
    dryRun: !!out.dryRun,
    case: plan.case
  });
  return { attempted: true, posted, out };
}

let intervalHandle = null;

/**
 * Call once from Discord `ready` — logs whether ingestion will run and X fetch prerequisites.
 */
function logXMentionIngestionReadyDiagnostics() {
  const enabled = isXMentionIngestionEnabled();
  const ms = pollIntervalMs();
  const replies = isXMentionReplyPostingEnabled();
  const creds = hasUserContextCredentials();
  const botIdSet = !!String(process.env.X_BOT_USER_ID || '').trim();
  const rawMax = Number(process.env.X_MENTION_FETCH_MAX || 10);
  const maxBatch = Math.min(100, Math.max(5, Number.isFinite(rawMax) ? Math.floor(rawMax) : 10));

  console.log('[XMentionIngest] ═══ startup diagnostics ═══');
  console.log(
    `[XMentionIngest] ingestion: ${enabled ? 'ENABLED' : 'DISABLED'} (env X_MENTION_INGESTION_ENABLED)`
  );
  console.log(`[XMentionIngest] poll interval: ${ms} ms`);
  console.log(
    `[XMentionIngest] post replies: ${replies ? 'ON' : 'OFF'} (env X_MENTION_POST_REPLIES)`
  );
  console.log(
    `[XMentionIngest] X API credentials: ${creds ? 'PRESENT (all 4 keys set)' : 'MISSING (fetch will return 0 candidates)'}`
  );
  console.log(
    `[XMentionIngest] X_BOT_USER_ID: ${botIdSet ? 'set' : 'not set — will call GET /2/users/me on first fetch'}`
  );
  console.log(`[XMentionIngest] mention batch size: ${maxBatch} (X_MENTION_FETCH_MAX, clamped 5–100)`);
  if (!enabled) {
    console.log('[XMentionIngest] note: polling does NOT start while ingestion is DISABLED.');
  }
  console.log('[XMentionIngest] ═══════════════════════════');
}

async function runIngestionTick(client) {
  const pollStart = new Date().toISOString();
  console.log(`[XMentionIngest] poll ▶ ${pollStart}`);

  const guild = resolveDefaultGuild(client);
  if (!guild) {
    console.warn('[XMentionIngest] poll ◼ abort: no guild (DISCORD_GUILD_ID / single guild)');
    return;
  }

  let candidates;
  try {
    candidates = await fetchXMentionCandidates();
  } catch (err) {
    console.error('[XMentionIngest] poll ◼ fetch threw (unexpected):', err.message);
    return;
  }

  const n = Array.isArray(candidates) ? candidates.length : 0;
  console.log(`[XMentionIngest] poll: fetched ${n} candidate(s)`);
  if (n === 0) {
    console.log('[XMentionIngest] poll: 0 mentions — nothing to process this cycle');
  }

  for (const c of candidates) {
    try {
      const bundle = await processSingleCandidate(client, guild, c);
      if (!bundle) {
        emitXMentionStructuredLog(c, null, null, { attempted: false });
        continue;
      }

      const { plan, targetReplyId } = bundle;
      const replyOutcome = await maybePostIntakeReply({ plan, targetReplyId });
      emitXMentionStructuredLog(c, bundle.result, plan, replyOutcome);
    } catch (err) {
      console.error('[XMentionIngest] candidate error:', c?.tweetId, err.message);
    }
  }

  console.log(`[XMentionIngest] poll ◼ end ${new Date().toISOString()} (candidates=${n})`);
}

/**
 * Starts a slow interval when X_MENTION_INGESTION_ENABLED is truthy. No-op otherwise.
 * @param {import('discord.js').Client} client
 */
function startXMentionIngestionScaffold(client) {
  if (!isXMentionIngestionEnabled()) {
    return;
  }

  if (intervalHandle) {
    console.warn('[XMentionIngest] Already running.');
    return;
  }

  const ms = pollIntervalMs();
  const rawMax = Number(process.env.X_MENTION_FETCH_MAX || 10);
  const maxBatch = Math.min(100, Math.max(5, Number.isFinite(rawMax) ? Math.floor(rawMax) : 10));
  console.log(
    `[XMentionIngest] Scaffold **enabled** — poll every ${ms}ms; candidates from X API v2 GET /users/:id/mentions ` +
      `(max ${maxBatch} per poll, min interval 15s). ` +
      `Replies: ${isXMentionReplyPostingEnabled() ? 'ALLOWED (if createPost succeeds)' : 'OFF (X_MENTION_POST_REPLIES)'}`
  );

  const tick = () => {
    runIngestionTick(client).catch(err => {
      console.error('[XMentionIngest] tick error:', err.message);
    });
  };

  intervalHandle = setInterval(tick, ms);
  tick();
}

function stopXMentionIngestionScaffold() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[XMentionIngest] Stopped.');
  }
}

module.exports = {
  isXMentionIngestionEnabled,
  isXMentionReplyPostingEnabled,
  pollIntervalMs,
  logXMentionIngestionReadyDiagnostics,
  fetchXMentionCandidates,
  fetchXMentionCandidatesStub,
  setXMentionCandidateProvider,
  processSingleCandidate,
  maybePostIntakeReply,
  runInjectedMentionOnce,
  startXMentionIngestionScaffold,
  stopXMentionIngestionScaffold,
  runIngestionTick
};
