'use strict';

require('dotenv').config();

const { getSupabase } = require('../utils/supabaseClient');
const supabase = getSupabase();

const features = [
  {
    feature_key: 'view_user_calls',
    free: true,
    pro: true,
    elite: true,
  },
  {
    feature_key: 'view_bot_calls',
    free: false,
    pro: true,
    elite: true,
  },
  {
    feature_key: 'advanced_stats',
    free: false,
    pro: true,
    elite: true,
  },
  {
    feature_key: 'elite_feed',
    free: false,
    pro: false,
    elite: true,
  },
];

(async () => {
  const { data, error } = await supabase
    .from('feature_access')
    .upsert(features, { onConflict: 'feature_key' });

  if (error) {
    console.error('[seedFeatures] Upsert failed:', error.message || error);
    process.exit(1);
  }

  console.log('[seedFeatures] Success:', data ?? '(no rows returned)');
  process.exit(0);
})();
