/**
 * Live X mention ingestion — **disabled by default**.
 *
 * Env:
 *   X_MENTION_INGESTION_ENABLED=1|true|yes  — start interval runner (still safe: candidate source is a stub until you implement fetch).
 *   X_MENTION_INGEST_POLL_MS=<ms>             — min 60000, default 300000 (5 min). Not aggressive polling.
 *   X_MENTION_POST_REPLIES=1|true|yes         — if set, may call createPost for reply policy outcomes (still obeys X_POST_DRY_RUN / API creds).
 *   DISCORD_GUILD_ID / X_INTAKE_GUILD_ID      — guild for intake membership checks (same as intake).
 *
 * Layers:
 *   1) fetchXMentionCandidates() — **stub returns []**; replace body or use setXMentionCandidateProvider() for stream/search later.
 *   2) processSingleCandidate() — processVerifiedXMentionCallIntake + logging.
 *   3) maybePostIntakeReply() — decideXMentionIntakeReply + gated createPost(reply).
 */

const { processVerifiedXMentionCallIntake, decideXMentionIntakeReply } = require('./xCallIntakeService');
const { createPost } = require('./xPoster');
const { resolveIntakeGuild } = require('./xIntakeGuildTrust');

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
  const n = Number(process.env.X_MENTION_INGEST_POLL_MS || 300000);
  if (!Number.isFinite(n)) return 300000;
  return Math.max(60000, Math.floor(n));
}

/**
 * @typedef {{ authorHandle: string, tweetText: string, tweetId: string, replyToTweetId?: string }} XMentionCandidate
 */

/** Default: no transport — implement search/stream here or inject via setXMentionCandidateProvider. */
async function fetchXMentionCandidatesStub() {
  return [];
}

let candidateProvider = fetchXMentionCandidatesStub;

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
 */
async function processSingleCandidate(client, guild, candidate) {
  const { authorHandle, tweetText, tweetId, replyToTweetId } = candidate;
  if (!authorHandle || !tweetText || !tweetId) {
    console.warn('[XMentionIngest] Skip candidate — missing authorHandle, tweetText, or tweetId');
    return null;
  }

  const result = await processVerifiedXMentionCallIntake(
    { authorHandle, tweetText, tweetId },
    { client, guild, dryRun: false }
  );

  const plan = decideXMentionIntakeReply(result, { authorHandle });
  const targetReplyId = replyToTweetId || tweetId;

  return { result, plan, targetReplyId };
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

async function runIngestionTick(client) {
  const guild = resolveDefaultGuild(client);
  if (!guild) {
    console.warn('[XMentionIngest] Tick skipped — could not resolve guild (DISCORD_GUILD_ID / single guild).');
    return;
  }

  let candidates;
  try {
    candidates = await fetchXMentionCandidates();
  } catch (err) {
    console.error('[XMentionIngest] fetchXMentionCandidates failed:', err.message);
    return;
  }

  for (const c of candidates) {
    try {
      const bundle = await processSingleCandidate(client, guild, c);
      if (!bundle) continue;

      const { result, plan, targetReplyId } = bundle;
      console.log('[XMentionIngest] processed', {
        tweetId: c.tweetId,
        success: result.success,
        reason: result.reason,
        replyCase: plan.case,
        shouldReply: plan.shouldReply
      });

      await maybePostIntakeReply({ plan, targetReplyId });
    } catch (err) {
      console.error('[XMentionIngest] candidate error:', c?.tweetId, err.message);
    }
  }
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
  console.log(
    `[XMentionIngest] Scaffold **enabled** — poll every ${ms}ms; candidates stub returns []. ` +
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
  fetchXMentionCandidates,
  setXMentionCandidateProvider,
  processSingleCandidate,
  maybePostIntakeReply,
  startXMentionIngestionScaffold,
  stopXMentionIngestionScaffold,
  runIngestionTick
};
