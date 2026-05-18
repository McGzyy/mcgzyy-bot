'use strict';

/**
 * One-time / periodic backfill: mirror data/referrals.json rows into public.referrals.
 *
 * Usage (repo root, with SUPABASE_URL + SUPABASE_ANON_KEY in .env):
 *   node scripts/syncReferralsJsonToPostgres.js
 *   node scripts/syncReferralsJsonToPostgres.js --dry-run
 */

require('dotenv').config();
const { syncReferralsJsonStoreToPostgres } = require('../utils/referralService');

const dryRun = process.argv.includes('--dry-run');

(async () => {
  const result = await syncReferralsJsonStoreToPostgres({ dryRun });
  console.log('[Referral sync]', dryRun ? '(dry run)' : '', result);
  process.exit(result.errors > 0 ? 1 : 0);
})().catch(err => {
  console.error('[Referral sync] fatal:', err?.message || err);
  process.exit(1);
});
