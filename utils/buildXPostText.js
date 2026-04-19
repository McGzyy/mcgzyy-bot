'use strict';

/**
 * Build approved-call X post body. Attribution line:
 * - Bot calls: always @McGBot
 * - User calls: @user when Supabase prefs allow tagging and multiple >= threshold; else generic credit
 */

function formatUsd(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'N/A';
  return `$${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function stripAt(handle) {
  return String(handle || '')
    .trim()
    .replace(/^@+/, '');
}

function getSupabaseForUserPrefs() {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const url = process.env.SUPABASE_URL;
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
      process.env.SUPABASE_ANON_KEY?.trim();
    if (!url || !key) return null;
    return createClient(url, key);
  } catch {
    return null;
  }
}

async function fetchUserXPostingPrefs(discordId) {
  if (!discordId || String(discordId).toUpperCase() === 'AUTO_BOT') return null;
  const supabase = getSupabaseForUserPrefs();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('users')
      .select(
        'x_handle, x_verified, x_milestone_tag_enabled, x_milestone_tag_min_multiple'
      )
      .eq('discord_id', String(discordId))
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

async function buildAttributionLine(trackedCall, multipleX) {
  if (!trackedCall) {
    return 'Called by: @McGBot';
  }

  if (trackedCall.callSourceType === 'bot_call') {
    return 'Called by: @McGBot';
  }

  const discordId = trackedCall.firstCallerDiscordId || trackedCall.firstCallerId;
  if (!discordId || String(discordId).toUpperCase() === 'AUTO_BOT') {
    return 'Credit: community call (McGBot Terminal)';
  }

  const prefs = await fetchUserXPostingPrefs(discordId);
  const verified = prefs && prefs.x_verified === true;
  const handle = stripAt(prefs?.x_handle);
  const enabled = prefs && prefs.x_milestone_tag_enabled === true;
  const minM = Number(prefs?.x_milestone_tag_min_multiple ?? 10);
  const mult = Number(multipleX) || 0;

  if (verified && handle && enabled && mult >= minM) {
    return `Called by: @${handle}`;
  }

  return 'Credit: community call (McGBot Terminal)';
}

async function buildXPostText(trackedCall) {
  const ticker = trackedCall.ticker || 'UNKNOWN';
  const ca = trackedCall.contractAddress || '';
  const firstCalledMc = Number(trackedCall.firstCalledMarketCap || 0);
  const latestMc = Number(
    trackedCall.latestMarketCap ||
      trackedCall.firstCalledMarketCap ||
      0
  );
  const displayX =
    firstCalledMc > 0 ? Number((latestMc / firstCalledMc).toFixed(2)) : 0;

  const initialMcStr = formatUsd(firstCalledMc);
  const athMcStr = formatUsd(
    trackedCall.ath ||
      trackedCall.athMc ||
      trackedCall.athMarketCap ||
      trackedCall.latestMarketCap ||
      trackedCall.firstCalledMarketCap ||
      0
  );

  const attribution = await buildAttributionLine(trackedCall, displayX);

  return [
    `🚀 $${ticker} — ${displayX.toFixed(2)}x from call`,
    ``,
    attribution,
    ``,
    `Initial MC: ${initialMcStr}`,
    `ATH MC: ${athMcStr}`,
    ``,
    `CA:`,
    `\`${ca}\``,
    ``,
    `📊 DexScreener: https://dexscreener.com/solana/${ca}`,
    `📊 GMGN: https://gmgn.ai/sol/token/${ca}`
  ].join('\n');
}

module.exports = { buildXPostText, buildAttributionLine };
