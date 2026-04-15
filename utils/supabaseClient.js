'use strict';

let supabaseInstance = null;

function getSupabase() {
  if (!supabaseInstance) {
    const { createClient } = require('@supabase/supabase-js');

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error("Supabase env not loaded");
    }

    supabaseInstance = createClient(url, key);
  }

  return supabaseInstance;
}

module.exports = { getSupabase };
