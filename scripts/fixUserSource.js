'use strict';

require('dotenv').config();

const { getSupabase } = require('../utils/supabaseClient');
const supabase = getSupabase();

(async () => {
  const { data, error } = await supabase
    .from('call_performance')
    .update({ source: 'user' })
    .eq('discord_id', '732566370914664499');

  if (error) {
    console.error('[fixUserSource] Update failed:', error.message || error);
    process.exit(1);
  }

  console.log('[fixUserSource] Success:', data ?? '(no rows returned)');
  process.exit(0);
})();
