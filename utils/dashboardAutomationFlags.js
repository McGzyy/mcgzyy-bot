'use strict';

/**
 * Cached dashboard_admin_settings flags for bot-side X automation (15s TTL).
 * Single Supabase read shared by outside poll, digests, milestones, mention poll.
 */

const { createClient } = require('@supabase/supabase-js');

const CACHE_MS = 15_000;

/** @type {{
 *   exp: number,
 *   checked: boolean,
 *   xAutomationPaused: boolean,
 *   xScheduledDigestsEnabled: boolean,
 *   outsideCallsEnabled: boolean,
 *   outsideXPollingEnabled: boolean
 * }} */
let cache = {
  exp: 0,
  checked: false,
  xAutomationPaused: false,
  xScheduledDigestsEnabled: false,
  outsideCallsEnabled: true,
  outsideXPollingEnabled: true
};

function getSupabaseServiceRole() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

function envTruthy(name) {
  const s = String(process.env[name] ?? '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/**
 * @returns {Promise<typeof cache>}
 */
async function refreshDashboardAutomationFlags() {
  const now = Date.now();
  if (cache.exp > now && cache.checked) {
    return cache;
  }

  const sb = getSupabaseServiceRole();
  if (!sb) {
    cache = {
      exp: now + CACHE_MS,
      checked: true,
      xAutomationPaused: false,
      xScheduledDigestsEnabled: envTruthy('X_LEADERBOARD_DIGEST_ENABLED'),
      outsideCallsEnabled: true,
      outsideXPollingEnabled: true
    };
    return cache;
  }

  const { data, error } = await sb
    .from('dashboard_admin_settings')
    .select(
      'x_automation_paused,x_scheduled_digests_enabled,outside_calls_enabled,outside_x_polling_enabled'
    )
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (
      msg.includes('x_automation_paused') ||
      msg.includes('x_scheduled_digests_enabled') ||
      error.code === '42703' ||
      error.code === 'PGRST204'
    ) {
      cache = {
        exp: now + CACHE_MS,
        checked: true,
        xAutomationPaused: false,
        xScheduledDigestsEnabled: envTruthy('X_LEADERBOARD_DIGEST_ENABLED'),
        outsideCallsEnabled: true,
        outsideXPollingEnabled: true
      };
      return cache;
    }
    console.warn('[DashboardAutomation] settings read failed:', error.message);
    cache = {
      exp: now + CACHE_MS,
      checked: true,
      xAutomationPaused: false,
      xScheduledDigestsEnabled: envTruthy('X_LEADERBOARD_DIGEST_ENABLED'),
      outsideCallsEnabled: true,
      outsideXPollingEnabled: true
    };
    return cache;
  }

  cache = {
    exp: now + CACHE_MS,
    checked: true,
    xAutomationPaused: data?.x_automation_paused === true,
    xScheduledDigestsEnabled: data?.x_scheduled_digests_enabled === true,
    outsideCallsEnabled: data == null ? true : data.outside_calls_enabled !== false,
    outsideXPollingEnabled: data == null ? true : data.outside_x_polling_enabled !== false
  };
  return cache;
}

/** Sync snapshot from last refresh (for /health status). */
function getDashboardAutomationFlagsSync() {
  return { ...cache };
}

async function isXAutomationPaused() {
  const f = await refreshDashboardAutomationFlags();
  return f.xAutomationPaused === true;
}

async function isScheduledDigestsEnabled() {
  const f = await refreshDashboardAutomationFlags();
  if (f.checked && f.xScheduledDigestsEnabled) {
    return true;
  }
  return envTruthy('X_LEADERBOARD_DIGEST_ENABLED');
}

async function isOutsideCallsProductEnabled() {
  const f = await refreshDashboardAutomationFlags();
  return f.outsideCallsEnabled !== false;
}

async function isOutsideXPollingEnabled() {
  const f = await refreshDashboardAutomationFlags();
  if (f.xAutomationPaused) return false;
  if (!f.outsideCallsEnabled) return false;
  return f.outsideXPollingEnabled !== false;
}

module.exports = {
  refreshDashboardAutomationFlags,
  getDashboardAutomationFlagsSync,
  isXAutomationPaused,
  isScheduledDigestsEnabled,
  isOutsideCallsProductEnabled,
  isOutsideXPollingEnabled
};
