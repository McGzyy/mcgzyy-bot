'use strict';

require('dotenv').config();

const { supabase } = require('../utils/supabaseClient');

const sample = [
  {
    discord_id: '732566370914664499',
    username: 'mcgzzy',
    ath_multiple: 4.2,
    source: 'bot',
    call_time: Date.now()
  },
  {
    discord_id: 'user2',
    username: 'alpha_caller',
    ath_multiple: 3.8,
    source: 'bot',
    call_time: Date.now()
  },
  {
    discord_id: 'user3',
    username: 'degen_dev',
    ath_multiple: 3.1,
    source: 'bot',
    call_time: Date.now()
  },
  {
    discord_id: 'user4',
    username: 'sol_scanner',
    ath_multiple: 2.9,
    source: 'bot',
    call_time: Date.now()
  },
  {
    discord_id: 'user5',
    username: 'user_caller_1',
    ath_multiple: 3.5,
    source: 'user',
    call_time: Date.now()
  },
  {
    discord_id: 'user6',
    username: 'alpha_sniper',
    ath_multiple: 2.7,
    source: 'user',
    call_time: Date.now()
  },
  {
    discord_id: 'user7',
    username: 'trend_hunter',
    ath_multiple: 4.1,
    source: 'user',
    call_time: Date.now()
  }
];

(async () => {
  const { data, error } = await supabase.from('call_performance').insert(sample);

  if (error) {
    console.error('[seedLeaderboard] Insert failed:', error.message || error);
    process.exit(1);
  }

  console.log('[seedLeaderboard] Success:', data ?? '(no rows returned)');
  process.exit(0);
})();
