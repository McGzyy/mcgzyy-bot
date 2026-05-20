#!/usr/bin/env node
'use strict';

/**
 * Local milestone card preview (no X post).
 * Usage: node scripts/previewMilestoneCard.js [sol_ca] [user|bot|both] [mult]
 * Omit sol_ca to use default test mint (JUP unless X_TEST_MILESTONE_CONTRACT is set).
 * Default variant: both (writes user + bot PNGs).
 */
require('dotenv').config();

const path = require('path');
const {
  buildMilestoneCardPreview,
  writeMilestonePreviewFile,
  DEFAULT_TEST_MILESTONE_CA
} = require('../utils/milestoneXTestPost');

const SOL_CA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,48}$/;

/**
 * @param {'user'|'bot'} variant
 * @param {string} ca
 * @param {number} mult
 */
async function renderVariant(variant, ca, mult) {
  const preview = await buildMilestoneCardPreview({
    variant,
    headlineMilestoneX: mult,
    contractAddress: ca,
    firstCallerDiscordId: process.env.BOT_OWNER_ID || null,
    discordMember: null
  });

  if (!preview.success || !preview.png) {
    throw new Error(preview.error || 'no_png');
  }

  const basename =
    variant === 'bot' ? '_preview_milestone_card_bot.png' : '_preview_milestone_card_user.png';
  const out = await writeMilestonePreviewFile(preview.png, basename);
  if (variant === 'user') {
    await writeMilestonePreviewFile(preview.png, '_preview_milestone_card.png');
  }

  return { out, preview, variant };
}

async function main() {
  let ca = process.argv[2];
  let variantArg = process.argv[3];
  let multArg = process.argv[4];

  if (ca && !SOL_CA_RE.test(ca)) {
    if (ca === 'user' || ca === 'bot' || ca === 'both') {
      multArg = variantArg;
      variantArg = ca;
      ca = '';
    } else {
      console.error('Usage: node scripts/previewMilestoneCard.js [sol_ca] [user|bot|both] [mult]');
      process.exit(1);
    }
  }

  ca = (ca && SOL_CA_RE.test(ca) ? ca : '') || DEFAULT_TEST_MILESTONE_CA;
  const mult = Number(multArg) || 25;
  const mode = variantArg === 'bot' ? 'bot' : variantArg === 'user' ? 'user' : 'both';
  const variants = mode === 'both' ? ['user', 'bot'] : [mode];

  for (const variant of variants) {
    const { out, preview } = await renderVariant(variant, ca, mult);
    console.log(`\n=== ${variant.toUpperCase()} ===`);
    console.log('Wrote', path.resolve(out));
    console.log('Ticker:', preview.tracked?.ticker, '|', preview.tracked?.tokenName);
    console.log('Live Dex:', preview.liveOk ? 'yes' : 'no');
    console.log('Caption:\n', preview.caption);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
