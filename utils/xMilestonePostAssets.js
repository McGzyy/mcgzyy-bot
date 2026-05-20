'use strict';

const { buildXMilestoneCaption } = require('./buildXPostText');
const { buildMilestoneCardPayload } = require('./xMilestoneCardPayload');
const { buildMilestoneDataCardPng } = require('./xMilestoneDataCard');
const { buildMilestoneHeroPng } = require('./milestoneHeroImage');
const { normalizePngUploadBuffer } = require('./xPoster');

function useLegacyHeroFallback() {
  const raw = String(process.env.X_MILESTONE_CARD_LEGACY_FALLBACK || '1')
    .trim()
    .toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no';
}

/**
 * Caption + optional PNG for milestone X posts (original posts get the data card).
 *
 * @param {object} trackedCall
 * @param {{ milestoneX: number, headlineX?: number, postRole?: 'anchor'|'update', isReply?: boolean, latestScan?: object|null, quotePreviousMilestone?: number }} opts
 * @returns {Promise<{ caption: string, png: Buffer|null, usedDataCard: boolean, replyPending?: boolean }>}
 */
async function buildXMilestonePostAssets(trackedCall, opts = {}) {
  const milestoneX = Number(opts.milestoneX) || 0;
  const headlineX = Number(opts.headlineX) > 0 ? Number(opts.headlineX) : milestoneX;
  const isReply = opts.isReply === true;
  const latestScan = opts.latestScan || null;
  const quotePreviousMilestone = Number(opts.quotePreviousMilestone) || 0;
  const postRole = opts.postRole === 'anchor' ? 'anchor' : opts.postRole === 'update' ? 'update' : '';

  const caption = await buildXMilestoneCaption(trackedCall, {
    milestoneX: headlineX,
    isReply,
    postRole,
    quotePreviousMilestone
  });

  if (isReply) {
    // Follow-up milestones: image-only (no caption). Dedicated reply card renderer TBD.
    const replyPng = await buildMilestoneReplyCardPng(trackedCall, { milestoneX, latestScan });
    return {
      caption: '',
      png: replyPng,
      usedDataCard: !!replyPng,
      replyPending: !replyPng
    };
  }

  let png = null;
  let usedDataCard = false;

  try {
    const payload = await buildMilestoneCardPayload(trackedCall, {
      milestoneX,
      headlineX,
      latestScan
    });
    const raw = await buildMilestoneDataCardPng(payload);
    png = normalizePngUploadBuffer(raw);
    usedDataCard = !!png;
  } catch (err) {
    console.error('[XMilestonePost] data card failed:', err?.message || err);
  }

  if (!png && useLegacyHeroFallback()) {
    try {
      const raw = await buildMilestoneHeroPng({
        milestoneX,
        seedKey: trackedCall?.contractAddress || trackedCall?.ticker || '',
        callSourceType: trackedCall?.callSourceType,
        ticker: trackedCall?.ticker
      });
      png = normalizePngUploadBuffer(raw);
    } catch (err) {
      console.error('[XMilestonePost] legacy hero fallback failed:', err?.message || err);
    }
  }

  return { caption, png, usedDataCard, replyPending: false };
}

/**
 * Reply-thread milestone image (separate design from the main data card).
 * @returns {Promise<Buffer|null>}
 */
async function buildMilestoneReplyCardPng(_trackedCall, _opts) {
  return null;
}

module.exports = {
  buildXMilestonePostAssets,
  buildMilestoneReplyCardPng
};
