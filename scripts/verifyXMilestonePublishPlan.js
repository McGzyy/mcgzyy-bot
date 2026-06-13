'use strict';

/**
 * Smoke-test milestone publish planning (anchor vs quote update vs ATH catch-up).
 * Run: node scripts/verifyXMilestonePublishPlan.js
 */

const assert = require('assert');
const { initScannerSettingsStore } = require('../utils/scannerSettingsService');
const {
  resolveMilestonePublishPlan,
  getBroadcastMilestoneLadder
} = require('../utils/xMilestonePublish');

async function main() {
  await initScannerSettingsStore();

  function plan(currentX, trackedCall) {
    return resolveMilestonePublishPlan(currentX, trackedCall);
  }

  const ladder = getBroadcastMilestoneLadder();
  console.log('[verify] broadcast ladder:', ladder.join(', '));

  // First approved bot call at 8x → anchor on approval rung
  let p = plan(8, {
    xApproved: true,
    xPostedMilestones: [],
    xOriginalPostId: null
  });
  assert(p, 'expected anchor plan at 8x');
  assert.strictEqual(p.postMode, 'anchor');
  assert.strictEqual(p.broadcastRung, 8);
  console.log('[verify] 8x anchor:', p.postMode, p.broadcastRung);

  // After anchor posted, 12x ATH → quote update at 10x broadcast rung
  p = plan(12, {
    xApproved: true,
    xPostedMilestones: [8],
    xOriginalPostId: '111',
    xLastPostedAthX: 8
  });
  assert(p, 'expected 10x quote at 12x ATH');
  assert.strictEqual(p.postMode, 'quote_update');
  assert.strictEqual(p.broadcastRung, 10);
  console.log('[verify] 12x quote:', p.postMode, p.broadcastRung, 'headline', p.headlineX);

  // After 10x quote, jump to 30x → next broadcast is 25x
  p = plan(30, {
    xApproved: true,
    xPostedMilestones: [8, 10],
    xOriginalPostId: '111',
    xLastPostedAthX: 12
  });
  assert(p, 'expected 25x quote at 30x ATH');
  assert.strictEqual(p.postMode, 'quote_update');
  assert.strictEqual(p.broadcastRung, 25);
  console.log('[verify] 30x quote:', p.postMode, p.broadcastRung);

  // Between rungs: 15x after 10x posted → ATH catch-up quote
  p = plan(15, {
    xApproved: true,
    xPostedMilestones: [8, 10],
    xOriginalPostId: '111',
    xLastPostedAthX: 10,
    xPostedAthCatchUps: []
  });
  assert(p, 'expected ATH catch-up between 10x and 25x');
  assert.strictEqual(p.kind, 'ath_catchup');
  assert.strictEqual(p.postMode, 'quote_update');
  console.log('[verify] 15x catch-up:', p.kind, p.headlineX);

  // Nothing left when all rungs posted and ATH flat
  p = plan(100, {
    xApproved: true,
    xPostedMilestones: [8, 10, 25, 50, 100],
    xOriginalPostId: '111',
    xLastPostedAthX: 100,
    xPostedAthCatchUps: [10, 25, 50, 100]
  });
  assert.strictEqual(p, null);
  console.log('[verify] fully posted → no plan (ok)');

  console.log('[verify] All milestone publish plan checks passed.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
