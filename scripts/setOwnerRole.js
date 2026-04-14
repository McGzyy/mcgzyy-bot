'use strict';

require('dotenv').config();

const { supabase } = require('../utils/supabaseClient');

(async () => {
  const { data, error } = await supabase
    .from('call_performance')
    .update({ role: 'owner', source: 'user' })
    .eq('discord_id', '732566370914664499');

  if (error) {
    console.error('[setOwnerRole] Update failed:', error.message || error);
    process.exit(1);
  }

  console.log('[setOwnerRole] Success:', data ?? '(no rows returned)');
  process.exit(0);
})();
