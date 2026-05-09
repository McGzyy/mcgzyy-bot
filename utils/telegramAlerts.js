/**
 * Outbound Telegram alerts (same TELEGRAM_BOT_TOKEN as FaSol ingest).
 *
 * Env:
 *   TELEGRAM_BOT_CALLS_CHANNEL_ID   — forum/broadcast channel for mirrored bot calls (FaSol path)
 *   TELEGRAM_BOT_CALLS_TOPIC_ID     — optional; required for forum “General” topics-style channels
 *   TELEGRAM_USER_CALLS_CHANNEL_ID  — channel for Discord user calls (!call / dashboard)
 *   TELEGRAM_USER_CALLS_TOPIC_ID    — optional forum topic for user calls
 *   TELEGRAM_USER_CALLS_BUTTONS     — optional inline keyboard JSON or Label|URL pairs ({ca})
 *   TELEGRAM_MILESTONES_CHANNEL_ID  — combined TG feed for bot + user milestones (monitor loop)
 *   TELEGRAM_MILESTONES_TOPIC_ID    — optional forum topic inside that channel
 */
const axios = require('axios');

function dexScreenerSolUrl(ca) {
  return `https://dexscreener.com/solana/${encodeURIComponent(String(ca || '').trim())}`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatUsdCompact(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 'N/A';
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatAgeSeconds(ageMinutes) {
  const m = Number(ageMinutes);
  if (!Number.isFinite(m) || m < 0) return null;
  const s = Math.round(m * 60);
  if (s < 60) return `${s}s`;
  const mm = Math.round(s / 60);
  if (mm < 60) return `${mm}m`;
  const h = Math.floor(mm / 60);
  const rem = mm % 60;
  return `${h}h${rem ? ` ${rem}m` : ''}`;
}

/** Build FaSol-shaped stats from a scanner scan (fallback when Telegram ingest doesn’t reply). */
function scanToFaSolParsedForTelegram(scan) {
  if (!scan || typeof scan !== 'object') {
    return { ticker: '', tokenName: '', stats: {}, holders: {}, security: {} };
  }
  return {
    ticker: scan.ticker || '',
    tokenName: scan.tokenName || '',
    stats: {
      marketCap: scan.marketCap ?? null,
      ath: scan.ath ?? null,
      liquidity: scan.liquidity ?? null,
      volume: scan.volume1h ?? null,
      fiveMinVol: scan.volume5m ?? null,
      ageMinutes: scan.ageMinutes ?? null,
      fiveMinChangePct: scan.fiveMinChangePct ?? null,
      makers: scan.makers ?? null,
      txBuys: scan.txBuys ?? null,
      txSells: scan.txSells ?? null
    },
    holders: {
      holders: scan.holders ?? null,
      top10Pct: scan.top10Pct ?? null,
      botsCount: scan.botsCount ?? null,
      botsPct: null,
      snipersCount: scan.snipersCount ?? null,
      snipersPct: null
    },
    security: {
      lpPct: scan.lpPct ?? null,
      dexUnpaid: scan.dexUnpaid ?? null,
      taxPct: scan.taxPct ?? null
    }
  };
}

/**
 * FaSol-style compact stats card for Telegram (HTML).
 * @param {object} parsed - output shape from parseFaSolPost (telegramFaSolMirror)
 * @param {string} contractAddress - CA (may include pump suffix)
 * @param {{ variant?: 'bot'|'user', callerLabel?: string, discordUserId?: string }} [opts]
 */
function formatFaSolTelegramHtml(parsed, contractAddress, opts = {}) {
  const variant = opts.variant === 'user' ? 'user' : 'bot';
  const callerLabel = opts.callerLabel ? String(opts.callerLabel).trim().slice(0, 120) : '';
  const discordUserId = opts.discordUserId ? String(opts.discordUserId).trim() : '';

  const ca = String(contractAddress || '').trim();
  const t = parsed?.ticker ? `$${String(parsed.ticker).toUpperCase()}` : 'TOKEN';
  const n = parsed?.tokenName ? String(parsed.tokenName) : '';

  const st = parsed?.stats || {};
  const sec = parsed?.security || {};
  const h = parsed?.holders || {};

  const mc = st.marketCap != null ? formatUsdCompact(st.marketCap) : null;
  const liq = st.liquidity != null ? formatUsdCompact(st.liquidity) : null;
  const ath = st.ath != null ? formatUsdCompact(st.ath) : null;
  const v5 = st.fiveMinVol != null ? formatUsdCompact(st.fiveMinVol) : null;
  const v1 = st.volume != null ? formatUsdCompact(st.volume) : null;
  const age = st.ageMinutes != null ? formatAgeSeconds(st.ageMinutes) : null;
  const ch5 =
    st.fiveMinChangePct != null ? `${st.fiveMinChangePct > 0 ? '+' : ''}${st.fiveMinChangePct.toFixed(2)}%` : null;
  const tx =
    st.txBuys != null || st.txSells != null ? `B ${st.txBuys ?? '—'}  S ${st.txSells ?? '—'}` : null;

  const callerLinked =
    variant === 'user' && callerLabel && discordUserId && /^\d{17,22}$/.test(discordUserId)
      ? `<a href="https://discord.com/users/${escapeHtml(discordUserId)}">${escapeHtml(callerLabel)}</a>`
      : callerLabel
        ? `<i>${escapeHtml(callerLabel)}</i>`
        : '';

  const titleLines =
    variant === 'user'
      ? [
          `👤 <b>Member call</b>${callerLinked ? ` · ${callerLinked}` : ''}`,
          `🌙 <b>${escapeHtml(t)}</b>${n ? ` · <i>${escapeHtml(n)}</i>` : ''}`
        ]
      : [`🔔 <b>McGBot Call</b> · <b>${escapeHtml(t)}</b>`, n ? `🪙 <i>${escapeHtml(n)}</i>` : null];

  const volRows =
    v5 && v1
      ? [
          ['V5', v5],
          ['1H', v1]
        ]
      : [['VOL', v5 || v1]];

  const statLines = [
    ['MC', mc],
    ['ATH', ath],
    ['LIQ', liq],
    ['AGE', age],
    ...volRows,
    ['TX', tx],
    ['P5', ch5],
    ['MK', st.makers != null ? String(st.makers) : null]
  ].filter(([, v]) => v != null);

  const padKey = (k) => String(k).padEnd(3, ' ');
  const statsPre = statLines.length
    ? `<pre>${statLines.map(([k, v]) => `${padKey(k)}  ${escapeHtml(v)}`).join('\n')}</pre>`
    : null;

  const holdersLine = (() => {
    const parts = [];
    if (h.holders != null) parts.push(`Holders ${h.holders}`);
    if (h.top10Pct != null) parts.push(`Top10 ${h.top10Pct.toFixed(2)}%`);
    if (h.botsCount != null) parts.push(`Bots ${h.botsCount}${h.botsPct != null ? ` (${h.botsPct.toFixed(2)}%)` : ''}`);
    if (h.snipersCount != null)
      parts.push(`Snipers ${h.snipersCount}${h.snipersPct != null ? ` (${h.snipersPct.toFixed(2)}%)` : ''}`);
    return parts.length ? `👥 <b>Holders</b> · ${escapeHtml(parts.join(' · '))}` : null;
  })();

  const securityLine = (() => {
    const parts = [];
    if (sec.lpPct != null) parts.push(`LP ${sec.lpPct.toFixed(2)}%`);
    if (sec.dexUnpaid === true) parts.push('DEX Unpaid');
    if (sec.taxPct != null) parts.push(`Tax ${sec.taxPct.toFixed(2)}%`);
    return parts.length ? `🛡️ <b>Security</b> · ${escapeHtml(parts.join(' · '))}` : null;
  })();

  return [
    ...titleLines.filter(Boolean),
    '',
    statsPre,
    holdersLine,
    securityLine,
    '',
    `CA: <code>${escapeHtml(ca)}</code>`,
    `<a href="${escapeHtml(dexScreenerSolUrl(ca))}">DexScreener</a>`
  ]
    .filter(Boolean)
    .join('\n');
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
 * @param {{
 *   chatId: number,
 *   messageThreadId?: number|null,
 *   text: string,
 *   parseMode?: 'HTML'|'MarkdownV2'|null,
 *   replyMarkup?: any,
 *   disableWebPreview?: boolean,
 *   logLabel?: string
 * }} opts
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
    disable_web_page_preview: opts.disableWebPreview !== false
  };
  if (opts.messageThreadId != null && Number.isFinite(opts.messageThreadId)) {
    body.message_thread_id = opts.messageThreadId;
  }
  if (opts.parseMode) {
    body.parse_mode = opts.parseMode;
  }
  if (opts.replyMarkup != null) {
    body.reply_markup = opts.replyMarkup;
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

function parseTelegramButtons(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  // Preferred: JSON (array of rows), e.g.:
  // [[{"text":"DexScreener","url":"https://dexscreener.com/solana/{ca}"}],[{"text":"Trade","url":"https://..."}]]
  if (s.startsWith('[')) {
    try {
      const v = JSON.parse(s);
      if (Array.isArray(v)) return v;
    } catch {
      // fall through
    }
  }

  // Fallback: "Label|Url,Label|Url" (single row)
  const row = [];
  for (const part of s.split(',').map(x => x.trim()).filter(Boolean)) {
    const [text, url] = part.split('|').map(x => (x ?? '').trim());
    if (!text || !url) continue;
    row.push({ text: text.slice(0, 64), url: url.slice(0, 2048) });
  }
  return row.length ? [row] : null;
}

function buildInlineKeyboardFromButtons(buttonRows, templateVars = {}) {
  if (!Array.isArray(buttonRows) || buttonRows.length === 0) return null;
  const rows = [];
  for (const row of buttonRows) {
    if (!Array.isArray(row) || row.length === 0) continue;
    const outRow = [];
    for (const btn of row) {
      const text = String(btn?.text ?? '').trim();
      let url = String(btn?.url ?? '').trim();
      if (!text || !url) continue;
      for (const [k, v] of Object.entries(templateVars || {})) {
        url = url.replaceAll(`{${k}}`, String(v));
      }
      outRow.push({ text: text.slice(0, 64), url: url.slice(0, 2048) });
    }
    if (outRow.length) rows.push(outRow);
  }
  if (!rows.length) return null;
  return { inline_keyboard: rows };
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
  const mc = formatUsdCompact(scan?.marketCap);
  const liq = formatUsdCompact(scan?.liquidity);
  const v5 = formatUsdCompact(scan?.volume5m);
  const v1h = formatUsdCompact(scan?.volume1h);
  const age = formatAgeSeconds(scan?.ageMinutes);
  const stats = [`MC ${mc}`, `Liq ${liq}`, `5m ${v5}`, `1h ${v1h}`, age ? `Age ${age}` : null]
    .filter(Boolean)
    .join(' · ');
  const text = [
    '🤖 Bot call',
    label || 'Token',
    ca,
    stats,
    dexScreenerSolUrl(ca)
  ]
    .filter(Boolean)
    .join('\n');

  const buttonsRaw = process.env.TELEGRAM_BOT_CALLS_BUTTONS;
  const buttons = buildInlineKeyboardFromButtons(parseTelegramButtons(buttonsRaw), { ca });
  await sendTelegramMessage({
    chatId,
    messageThreadId: topicId,
    text,
    replyMarkup: buttons || undefined,
    logLabel: 'bot-calls TG'
  });
}

/** If scan fails, still post CA + link (so you never miss a call). */
async function mirrorBotMintFallbackToTelegram(contractAddress) {
  const { chatId, topicId } = botCallsTelegramTarget();
  if (chatId == null) return;
  const ca = String(contractAddress || '').trim();
  if (!ca) return;
  const text = ['🤖 Bot call (fallback)', ca, dexScreenerSolUrl(ca)].join('\n');
  await sendTelegramMessage({
    chatId,
    messageThreadId: topicId,
    text,
    logLabel: 'bot-calls TG fallback'
  });
}

/** Discord user call → FaSol-style card in TG (scanner stats + FaSol merge already on scan). */
async function mirrorUserCallToTelegram(scan, callerLabel) {
  const { chatId, topicId } = userCallsTelegramTarget();
  if (chatId == null) return;
  const ca = String(scan?.contractAddress || '').trim();
  if (!ca) return;
  const who = callerLabel ? String(callerLabel).slice(0, 120) : 'Member';
  const discordUserId = String(scan?.firstCallerDiscordId || '').trim();

  const enriched = scan?.__faSolParsed && typeof scan.__faSolParsed === 'object' ? scan.__faSolParsed : null;
  const parsed =
    enriched && scan?.__usedFaSolEnrichment === true ? enriched : scanToFaSolParsedForTelegram(scan);

  const buttonsRaw =
    String(process.env.TELEGRAM_USER_CALLS_BUTTONS || '').trim() ||
    String(process.env.TELEGRAM_BOT_CALLS_BUTTONS || '').trim();
  const replyMarkup = buildInlineKeyboardFromButtons(parseTelegramButtons(buttonsRaw), { ca });

  await sendTelegramMessage({
    chatId,
    messageThreadId: topicId,
    text: formatFaSolTelegramHtml(parsed, ca, {
      variant: 'user',
      callerLabel: who,
      discordUserId
    }),
    parseMode: 'HTML',
    replyMarkup: replyMarkup || undefined,
    disableWebPreview: true,
    logLabel: 'user-calls TG card'
  });
}

module.exports = {
  sendTelegramMessage,
  parseTelegramButtons,
  buildInlineKeyboardFromButtons,
  formatFaSolTelegramHtml,
  scanToFaSolParsedForTelegram,
  escapeHtml,
  formatUsdCompact,
  formatAgeSeconds,
  dexScreenerSolUrl,
  mirrorBotCallToTelegram,
  mirrorBotMintFallbackToTelegram,
  mirrorUserCallToTelegram,
  mirrorMilestoneToTelegram,
  botCallsTelegramTarget,
  userCallsTelegramTarget,
  milestonesTelegramTarget
};
