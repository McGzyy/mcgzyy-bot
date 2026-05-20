'use strict';

const path = require('path');
const fs = require('fs').promises;
const { createPost } = require('./xPoster');
const { buildXMilestonePostAssets } = require('./xMilestonePostAssets');
const { getHighestEligibleApprovalMilestone } = require('./approvalMilestoneService');
const { fetchRealTokenData } = require('../providers/realTokenProvider');
const { getTrackedCall, initTrackedCallsStore } = require('./trackedCallsService');
const { initUserProfilesStore } = require('./userProfileService');
const { resolveScanThumbnailUrl } = require('./embedTokenThumbnail');

/** Default preview mint when none is passed (Jupiter). Override with `X_TEST_MILESTONE_CONTRACT`. */
const DEFAULT_TEST_MILESTONE_CA =
  String(process.env.X_TEST_MILESTONE_CONTRACT || '').trim() ||
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';

/** @deprecated use DEFAULT_TEST_MILESTONE_CA */
const DEFAULT_WRAP_SOL = DEFAULT_TEST_MILESTONE_CA;

/**
 * @param {{ variant: 'user' | 'bot', milestoneAthX: number, spotX?: number|null, contractAddress?: string|null, firstCallerDiscordId?: string|null, discordMember?: { id?: string, username?: string, displayName?: string }|null }}
 */
function buildSyntheticTrackedCallForXMilestoneTest(p) {
  const variant = p.variant === 'bot' ? 'bot' : 'user';
  const ca = String(p.contractAddress || '').trim() || DEFAULT_TEST_MILESTONE_CA;
  const mult = Number(p.milestoneAthX);
  const m = Number.isFinite(mult) && mult >= 1.01 ? mult : 8;
  const spotRaw = p.spotX != null ? Number(p.spotX) : m * 0.94;
  const spot = Number.isFinite(spotRaw) && spotRaw > 0 ? Math.min(spotRaw, m * 0.999) : m * 0.94;
  const entry = 400_000;
  const athMc = entry * m;
  const latestMc = entry * spot;

  const member = p.discordMember && typeof p.discordMember === 'object' ? p.discordMember : null;
  const callerId =
    variant === 'user'
      ? String(p.firstCallerDiscordId || member?.id || '').trim() || null
      : null;
  const callerName =
    variant === 'bot'
      ? 'McGBot'
      : String(member?.displayName || member?.username || 'Preview Caller').trim() || 'Preview Caller';

  return {
    contractAddress: ca,
    ticker: 'TEST',
    tokenName: 'Milestone layout test',
    firstCalledMarketCap: entry,
    latestMarketCap: latestMc,
    ath: athMc,
    athMc: athMc,
    athMarketCap: athMc,
    callSourceType: variant === 'bot' ? 'bot_call' : 'user_call',
    firstCallerDiscordId: callerId,
    firstCallerUsername: member?.username || (variant === 'bot' ? 'McGBot' : 'preview_caller'),
    firstCallerDisplayName: callerName,
    firstCallerPublicName: callerName,
    firstCalledAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    tokenImageUrl: null,
    xApproved: true
  };
}

/**
 * Merge tracked-call row + live Dex data for realistic card previews.
 * @param {object} tracked
 * @param {string} ca
 * @returns {Promise<{ tracked: object, latestScan: object|null, liveOk: boolean }>}
 */
async function enrichMilestoneTestFromLiveData(tracked, ca) {
  const mint = String(ca || tracked.contractAddress || '').trim();
  /** @type {object|null} */
  let latestScan = null;
  let liveOk = false;

  let existing = null;
  if (mint) {
    try {
      await initUserProfilesStore();
      await initTrackedCallsStore();
      existing = getTrackedCall(mint);
    } catch {
      existing = null;
    }
  }
  if (existing) {
    tracked.tokenName = existing.tokenName || tracked.tokenName;
    tracked.ticker = existing.ticker || tracked.ticker;
    tracked.tokenImageUrl = existing.tokenImageUrl || tracked.tokenImageUrl;
    tracked.firstCalledMarketCap =
      Number(existing.firstCalledMarketCap) > 0
        ? Number(existing.firstCalledMarketCap)
        : tracked.firstCalledMarketCap;
    tracked.firstCalledAt = existing.firstCalledAt || tracked.firstCalledAt;
    if (existing.callSourceType) tracked.callSourceType = existing.callSourceType;
    if (existing.firstCallerDiscordId && String(existing.firstCallerDiscordId).toUpperCase() !== 'AUTO_BOT') {
      tracked.firstCallerDiscordId = existing.firstCallerDiscordId;
      tracked.firstCallerUsername = existing.firstCallerUsername || tracked.firstCallerUsername;
      tracked.firstCallerDisplayName =
        existing.firstCallerDisplayName || tracked.firstCallerDisplayName;
      tracked.firstCallerPublicName =
        existing.firstCallerPublicName || tracked.firstCallerPublicName;
    }
    const exAth = Number(
      existing.athMc || existing.ath || existing.athMarketCap || existing.latestMarketCap || 0
    );
    if (exAth > 0) {
      tracked.ath = exAth;
      tracked.athMc = exAth;
      tracked.athMarketCap = exAth;
      const entry = Number(tracked.firstCalledMarketCap || 0);
      if (entry > 0) {
        tracked.latestMarketCap = Math.min(exAth, entry * Number(tracked.headlineMult || 0) || exAth);
      }
    }
  }

  if (!mint) {
    return { tracked, latestScan, liveOk };
  }

  try {
    const real = await fetchRealTokenData(mint, { interactive: true });
    const token = real?.token || {};
    const market = real?.market || {};

    if (token.ticker) tracked.ticker = String(token.ticker).trim().replace(/^\$+/, '');
    if (token.tokenName) tracked.tokenName = String(token.tokenName).trim();

    const logo = String(token.logoURI || token.imageUrl || '').trim();
    if (logo) tracked.tokenImageUrl = logo;

    const liveMc = Number(market.marketCap);
    if (liveMc > 0) {
      const entry = Number(tracked.firstCalledMarketCap || 0);
      if (entry > 0) {
        const impliedAth = Math.max(entry, liveMc);
        tracked.ath = impliedAth;
        tracked.athMc = impliedAth;
        tracked.athMarketCap = impliedAth;
        tracked.latestMarketCap = liveMc;
      }
    }

    latestScan = {
      contractAddress: mint,
      tokenImageUrl: tracked.tokenImageUrl,
      token: { imageUrl: tracked.tokenImageUrl },
      pairCreatedAt: market.pairCreatedAt,
      ageMinutes: market.ageMinutes,
      marketCap: liveMc
    };
    const thumb = resolveScanThumbnailUrl(latestScan);
    if (thumb) {
      tracked.tokenImageUrl = thumb;
      latestScan.tokenImageUrl = thumb;
      latestScan.token = { imageUrl: thumb };
    }
    liveOk = true;
  } catch (e) {
    console.error('[MilestoneTest] live token fetch failed:', e?.message || e);
    latestScan = {
      contractAddress: mint,
      tokenImageUrl: tracked.tokenImageUrl,
      token: { imageUrl: tracked.tokenImageUrl },
      pairCreatedAt: Date.now() - 36 * 60 * 60 * 1000,
      ageMinutes: 36 * 60
    };
  }

  return { tracked, latestScan, liveOk };
}

/**
 * Build card PNG + caption without posting to X.
 * @param {{
 *   variant: 'user' | 'bot',
 *   headlineMilestoneX: number,
 *   contractAddress?: string|null,
 *   firstCallerDiscordId?: string|null,
 *   discordMember?: { id?: string, username?: string, displayName?: string }|null,
 *   quotePreviousMilestone?: number
 * }} p
 */
async function buildMilestoneCardPreview(p) {
  const variant = p.variant === 'bot' ? 'bot' : 'user';
  const mx = Number(p.headlineMilestoneX);
  if (!Number.isFinite(mx) || mx < 2) {
    return { success: false, error: 'headlineMilestoneX must be >= 2' };
  }

  const ca =
    (p.contractAddress && String(p.contractAddress).trim()) || DEFAULT_TEST_MILESTONE_CA;

  const tracked = buildSyntheticTrackedCallForXMilestoneTest({
    variant,
    milestoneAthX: mx,
    spotX: mx * 0.93,
    contractAddress: ca,
    firstCallerDiscordId: p.firstCallerDiscordId || null,
    discordMember: p.discordMember || null
  });
  tracked.headlineMult = mx;

  const { tracked: enriched, latestScan, liveOk } = await enrichMilestoneTestFromLiveData(tracked, ca);

  const entry = Number(enriched.firstCalledMarketCap || 0);
  if (entry > 0) {
    enriched.ath = entry * mx;
    enriched.athMc = enriched.ath;
    enriched.athMarketCap = enriched.ath;
    enriched.latestMarketCap = entry * Math.min(mx * 0.94, mx - 0.01);
  }

  const quotePrev = Number(p.quotePreviousMilestone) || 0;
  const { caption, png, usedDataCard } = await buildXMilestonePostAssets(enriched, {
    milestoneX: mx,
    isReply: false,
    latestScan,
    quotePreviousMilestone: quotePrev
  });

  return {
    success: true,
    png: png || null,
    caption,
    usedDataCard: !!usedDataCard,
    tracked: enriched,
    liveOk,
    contractAddress: ca
  };
}

/**
 * @param {{
 *   variant: 'user' | 'bot',
 *   replyToTweetId?: string | null,
 *   headlineMilestoneX: number,
 *   contractAddress?: string | null,
 *   firstCallerDiscordId?: string | null,
 *   discordMember?: { id?: string, username?: string, displayName?: string }|null
 * }} p
 */
async function postTestMilestoneToX(p) {
  const variant = p.variant === 'bot' ? 'bot' : 'user';
  const quoteTweetId = String(p.quoteTweetId || p.replyToTweetId || '').trim();
  const mx = Number(p.headlineMilestoneX);
  if (!Number.isFinite(mx) || mx < 2) {
    return { success: false, error: 'headlineMilestoneX must be >= 2' };
  }

  const quotePrev = Number(p.quotePreviousMilestone) || 0;

  const preview = await buildMilestoneCardPreview({
    variant,
    headlineMilestoneX: mx,
    contractAddress: p.contractAddress,
    firstCallerDiscordId: p.firstCallerDiscordId,
    discordMember: p.discordMember,
    quotePreviousMilestone: quotePrev
  });

  if (!preview.success) {
    return { success: false, error: preview.error || 'preview_failed' };
  }

  const { caption: postText, png: chartBuf, usedDataCard, tracked, liveOk } = preview;

  if (!chartBuf) {
    return {
      success: false,
      error: 'card_render_failed',
      textLength: 0,
      chartAttached: false,
      dataCard: false,
      liveToken: liveOk,
      ticker: tracked.ticker,
      tokenName: tracked.tokenName
    };
  }

  const result = await createPost(postText, null, chartBuf, {
    quoteTweetId: quoteTweetId || undefined,
    audit: {
      category: 'manual_test_milestone',
      callSourceType: tracked.callSourceType || null,
      quoted: Boolean(quoteTweetId)
    }
  });
  return {
    success: !!result.success,
    id: result.id || null,
    error: result.error,
    textLength: postText.length,
    chartAttached: !!chartBuf,
    quoted: Boolean(quoteTweetId),
    dataCard: usedDataCard,
    liveToken: liveOk,
    ticker: tracked.ticker,
    tokenName: tracked.tokenName
  };
}

/**
 * Write preview PNG under data/ for local inspection.
 * @param {Buffer} png
 * @param {string} [basename]
 */
async function writeMilestonePreviewFile(png, basename = 'milestone_preview.png') {
  const dir = path.join(__dirname, '../data');
  await fs.mkdir(dir, { recursive: true });
  const out = path.join(dir, basename);
  await fs.writeFile(out, png);
  return out;
}

function defaultOriginalMilestoneX() {
  return getHighestEligibleApprovalMilestone(12) || 8;
}

function defaultReplyMilestoneX() {
  return getHighestEligibleApprovalMilestone(45) || 30;
}

const XMILESTONE_USAGE =
  '**Usage**\n' +
  '• `!previewxmilestone user <sol_ca> [mult]` / `bot` — **Discord preview** (card + caption; no X)\n' +
  '• `!testxmilestone user <sol_ca> [mult]` — post to X (member styling + caption)\n' +
  '• `!testxmilestone bot <sol_ca> [mult]` — post to X (green McGBot card + caption)\n' +
  '• `!testxmilestone quote <post_id> user|bot [mult]` — standalone **quote-tweet** test (optional `quotePreviousMilestone` via ladder)\n' +
  '• Add `@member` before mult to use another caller’s Supabase avatar (user variant)\n' +
  'Default mint: `X_TEST_MILESTONE_CONTRACT` env, else **JUP** (`JUPyiwrY…ZsDvCN`). Any Solana CA works.';

/**
 * @param {string} content full message
 * @param {{ defaultMx: number, allowReply?: boolean }} opts
 */
function parseXmilestoneCommandParts(content, opts) {
  const parts = content.trim().split(/\s+/).slice(1);
  if (parts.length < 1) {
    return { ok: false, error: XMILESTONE_USAGE };
  }

  /** @type {'user' | 'bot' | null} */
  let variant = null;
  let replyToId = '';
  let headlineMx = 0;
  /** @type {string | null} */
  let contractOverride = null;
  /** @type {string | null} */
  let callerDiscordId = null;

  const isLikelySolanaCA = s => /^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(String(s || '').trim());
  const mentionId = s => {
    const m = String(s || '').match(/^<@!?(\d+)>$/);
    return m ? m[1] : null;
  };

  const quoteKw = parts[0].toLowerCase();
  if (quoteKw === 'quote' || quoteKw === 'reply') {
    if (!opts.allowReply) {
      return { ok: false, error: 'Quote mode is only for `!testxmilestone`.' };
    }
    replyToId = String(parts[1] || '').trim();
    if (!/^\d{10,22}$/.test(replyToId)) {
      return {
        ok: false,
        error: `❌ After \`${quoteKw}\`, paste the **numeric X post ID** to quote.\n\n` + XMILESTONE_USAGE
      };
    }
    const v = String(parts[2] || '').toLowerCase();
    if (v !== 'user' && v !== 'bot') {
      return {
        ok: false,
        error: '❌ After the post ID, specify **user** or **bot**.\n\n' + XMILESTONE_USAGE
      };
    }
    variant = v === 'bot' ? 'bot' : 'user';
    headlineMx =
      parts[3] != null && parts[3] !== '' && Number.isFinite(Number(parts[3]))
        ? Number(parts[3])
        : defaultReplyMilestoneX();
    return {
      ok: true,
      variant,
      replyToId,
      quoteTweetId: replyToId,
      headlineMx,
      quotePreviousMilestone: 10,
      contractOverride,
      callerDiscordId
    };
  }

  const v = String(parts[0] || '').toLowerCase();
  if (v !== 'user' && v !== 'bot') {
    return { ok: false, error: XMILESTONE_USAGE };
  }
  variant = v === 'bot' ? 'bot' : 'user';

  let idx = 1;
  if (parts[idx] && isLikelySolanaCA(parts[idx])) {
    contractOverride = parts[idx];
    idx += 1;
  }
  while (parts[idx]) {
    const mid = mentionId(parts[idx]);
    if (mid) {
      callerDiscordId = mid;
      idx += 1;
      continue;
    }
    if (Number.isFinite(Number(parts[idx]))) {
      headlineMx = Number(parts[idx]);
      idx += 1;
      break;
    }
    idx += 1;
  }
  if (!headlineMx) {
    headlineMx = opts.defaultMx;
  }

  if (!Number.isFinite(headlineMx) || headlineMx < 2) {
    return { ok: false, error: '❌ Multiplier must be a number ≥ 2.' };
  }

  return { ok: true, variant, replyToId, headlineMx, contractOverride, callerDiscordId };
}

module.exports = {
  postTestMilestoneToX,
  buildMilestoneCardPreview,
  parseXmilestoneCommandParts,
  XMILESTONE_USAGE,
  buildSyntheticTrackedCallForXMilestoneTest,
  enrichMilestoneTestFromLiveData,
  writeMilestonePreviewFile,
  DEFAULT_TEST_MILESTONE_CA,
  defaultOriginalMilestoneX,
  defaultReplyMilestoneX
};
