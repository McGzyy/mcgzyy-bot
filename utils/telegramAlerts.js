/**
 * Outbound Telegram alerts (same TELEGRAM_BOT_TOKEN as FaSol ingest).
 *
 * Env:
 *   TELEGRAM_BOT_CALLS_CHANNEL_ID   — forum/broadcast channel for mirrored bot calls (FaSol path)
 *   TELEGRAM_BOT_CALLS_TOPIC_ID     — optional; required for forum “General” topics-style channels
 *   TELEGRAM_USER_CALLS_CHANNEL_ID  — channel for Discord user calls (!call / dashboard)
 *   TELEGRAM_USER_CALLS_TOPIC_ID    — optional forum topic for user calls
 *   TELEGRAM_MILESTONES_CHANNEL_ID  — combined TG feed for bot + user milestones (monitor loop)
 *   TELEGRAM_MILESTONES_TOPIC_ID    — optional forum topic inside that channel
 */
const axios = require('axios');

function dexScreenerSolUrl(ca) {
  return `https://dexscreener.com/solana/${encodeURIComponent(String(ca || '').trim())}`;
}

function parseChatId(raw) {
  const n = Number(String(raw ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

function parseTopicId(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function getApiBase() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!token) return null;
  return `https://api.telegram.org/bot${encodeURIComponent(token)}`;
}

/**
 * @param {{ chatId: number, messageThreadId?: number|null, text: string, logLabel?: string }} opts
 * @returns {Promise<boolean>}
 */
async function sendTelegramMessage(opts) {
  const apiBase = getApiBase();
  if (!apiBase) return false;
  const chatId = opts.chatId;
  if (chatId == null || !Number.isFinite(chatId)) return false;
  const body = {
    chat_id: chatId,
    text: opts.text,
    disable_web_page_preview: false
  };
  if (opts.messageThreadId != null && Number.isFinite(opts.messageThreadId)) {
    body.message_thread_id = opts.messageThreadId;
  }
  try {
    await axios.post(`${apiBase}/sendMessage`, body, { timeout: 15000 });
    return true;
  } catch (e) {
    const desc = e?.response?.data?.description || e?.message || e;
    console.warn(`[TelegramAlerts] ${opts.logLabel || 'sendMessage'}:`, desc);
    return false;
  }
}

function botCallsTelegramTarget() {
  return {
    chatId: parseChatId(process.env.TELEGRAM_BOT_CALLS_CHANNEL_ID),
    topicId: parseTopicId(process.env.TELEGRAM_BOT_CALLS_TOPIC_ID)
  };
}

function userCallsTelegramTarget() {
  return {
    chatId: parseChatId(process.env.TELEGRAM_USER_CALLS_CHANNEL_ID),
    topicId: parseTopicId(process.env.TELEGRAM_USER_CALLS_TOPIC_ID)
  };
}

function milestonesTelegramTarget() {
  return {
    chatId: parseChatId(process.env.TELEGRAM_MILESTONES_CHANNEL_ID),
    topicId: parseTopicId(process.env.TELEGRAM_MILESTONES_TOPIC_ID)
  };
}

function milestoneKindLabel(callSourceType) {
  const s = String(callSourceType || '').toLowerCase();
  if (s === 'bot_call') return 'Bot';
  if (s === 'watch_only') return 'Watch';
  return 'User';
}

/** Monitoring milestone → short line (both user + bot buckets use same TG destination if set) */
async function mirrorMilestoneToTelegram(payload) {
  const { coin, scan, milestoneKey, performancePercent, realXFromCall } = payload;
  const { chatId, topicId } = milestonesTelegramTarget();
  if (chatId == null) return;

  const ca = String(coin?.contractAddress || scan?.contractAddress || '').trim();
  if (!ca) return;

  const name = coin?.tokenName || scan?.tokenName || 'Token';
  const ticker = coin?.ticker || scan?.ticker || '';
  const label = ticker ? `${name} (${ticker})` : name;
  const kind = milestoneKindLabel(coin?.callSourceType);

  let xBit = '';
  if (realXFromCall != null && Number.isFinite(Number(realXFromCall))) {
    xBit = ` · ~${Number(realXFromCall).toFixed(2)}x from call`;
  }

  let perfBit = '';
  if (performancePercent != null && Number.isFinite(Number(performancePercent))) {
    perfBit = ` · Since call ${Number(performancePercent).toFixed(1)}%`;
  }

  const text = [
    `📈 Milestone · ${kind}${xBit}${perfBit}`,
    `${String(milestoneKey)} — ${label}`,
    ca,
    dexScreenerSolUrl(ca)
  ].join('\n');

  await sendTelegramMessage({
    chatId,
    messageThreadId: topicId,
    text,
    logLabel: 'milestones TG'
  });
}

/** FaSol mirror → short line in TG bot-call destination */
async function mirrorBotCallToTelegram(scan) {
  const { chatId, topicId } = botCallsTelegramTarget();
  if (chatId == null) return;
  const ca = String(scan?.contractAddress || '').trim();
  if (!ca) return;
  const label = [scan?.tokenName, scan?.ticker ? `(${scan.ticker})` : '']
    .filter(Boolean)
    .join(' ')
    .trim();
  const text = ['🤖 Bot call', label || 'Token', ca, dexScreenerSolUrl(ca)].join('\n');
  await sendTelegramMessage({
    chatId,
    messageThreadId: topicId,
    text,
    logLabel: 'bot-calls TG'
  });
}

/** Discord user call → short line in TG user-call destination */
async function mirrorUserCallToTelegram(scan, callerLabel) {
  const { chatId, topicId } = userCallsTelegramTarget();
  if (chatId == null) return;
  const ca = String(scan?.contractAddress || '').trim();
  if (!ca) return;
  const label = [scan?.tokenName, scan?.ticker ? `(${scan.ticker})` : '']
    .filter(Boolean)
    .join(' ')
    .trim();
  const who = callerLabel ? String(callerLabel).slice(0, 120) : 'Member';
  const text = ['👤 User call', who, label || 'Token', ca, dexScreenerSolUrl(ca)].join('\n');
  await sendTelegramMessage({
    chatId,
    messageThreadId: topicId,
    text,
    logLabel: 'user-calls TG'
  });
}

module.exports = {
  sendTelegramMessage,
  mirrorBotCallToTelegram,
  mirrorUserCallToTelegram,
  mirrorMilestoneToTelegram,
  botCallsTelegramTarget,
  userCallsTelegramTarget,
  milestonesTelegramTarget
};
