/**
 * Telegram → Discord bot-call mirror (FaSol private group).
 *
 * Env (mcgzyy-bot/.env or repo .env):
 *   TELEGRAM_BOT_TOKEN           — McGBot Telegram bot (@McGzyyBot) token
 *   TELEGRAM_FASOL_MIRROR        — set to "1" / "true" / "yes" to enable
 *   TELEGRAM_FASOL_CHAT_ID       — numeric chat id of the private FaSol group (often negative for supergroups)
 *   TELEGRAM_FASOL_USERNAME      — optional, default "fasolcallbot" (no @)
 *   TELEGRAM_BOT_CALLS_CHANNEL_ID — members TG hub: bot-call lines after FaSol mirror (see utils/telegramAlerts.js)
 *   TELEGRAM_BOT_CALLS_TOPIC_ID   — optional forum topic id for that channel
 *
 * Flow: FaSol group → generateRealScan → Discord #bot-calls (full embed) → TG bot-call line if CHANNEL_ID set.
 *
 * McGBot Telegram: BotFather → Group privacy OFF so the bot receives all messages in the group.
 */
const axios = require('axios');
const { postBotCallScan } = require('./autoCallEngine');
const { autoCallConfig } = require('../config/autoCallConfig');
const { getTrackedCall } = require('./trackedCallsService');
const {
  mirrorBotCallToTelegram,
  botCallsTelegramTarget,
  parseTelegramButtons,
  buildInlineKeyboardFromButtons,
  sendTelegramMessage,
  escapeHtml,
  formatUsdCompact,
  formatAgeSeconds,
  dexScreenerSolUrl
} = require('./telegramAlerts');

// Pump.fun alerts sometimes append literal "pump" after the mint.
// Capture group 1 is the actual mint; suffix is ignored.
const MINT_RE = /\b([1-9A-HJ-NP-Za-km-z]{32,44})(?:pump)?\b/g;

function truthyEnv(v) {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isLikelySolanaMint(s) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(s || '').trim());
}

function extractMintsFromTelegramMessage(message) {
  const out = new Set();
  const text = [message?.text, message?.caption].filter(Boolean).join('\n');
  if (text) {
    for (const mm of text.matchAll(MINT_RE)) {
      const mint = mm && mm[1] ? String(mm[1]).trim() : '';
      if (mint) out.add(mint);
    }
  }

  const entities = [...(message?.entities || []), ...(message?.caption_entities || [])];
  const src = message?.text || message?.caption || '';
  for (const ent of entities) {
    if (!ent || typeof ent.offset !== 'number' || typeof ent.length !== 'number') continue;
    const slice = src.slice(ent.offset, ent.offset + ent.length);
    if (ent.type === 'url' || ent.type === 'text_link') {
      const url = ent.type === 'text_link' ? ent.url : slice;
      if (typeof url === 'string') {
        for (const m2 of url.matchAll(MINT_RE)) {
          const mint = m2 && m2[1] ? String(m2[1]).trim() : '';
          if (mint) out.add(mint);
        }
      }
    }
    if (slice && isLikelySolanaMint(slice)) out.add(slice.trim());
  }

  // Many alert channels include mint only in inline button URLs (reply_markup.inline_keyboard).
  const kb = message?.reply_markup?.inline_keyboard;
  if (Array.isArray(kb)) {
    for (const row of kb) {
      if (!Array.isArray(row)) continue;
      for (const btn of row) {
        const url = btn && typeof btn.url === 'string' ? btn.url : '';
        if (!url) continue;
        for (const m3 of url.matchAll(MINT_RE)) {
          const mint = m3 && m3[1] ? String(m3[1]).trim() : '';
          if (mint) out.add(mint);
        }
      }
    }
  }

  return [...out];
}

function senderUsernameFromMessage(message) {
  const u =
    message?.from?.username ||
    message?.sender_chat?.username ||
    message?.forward_from?.username ||
    '';
  return String(u || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
}

function parseUsdLike(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/\$?\s*([0-9]+(?:\.[0-9]+)?)\s*([kKmMbB])?\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = (() => {
    const suf = String(m[2] || '').toLowerCase();
    if (suf === 'k') return 1_000;
    if (suf === 'm') return 1_000_000;
    if (suf === 'b') return 1_000_000_000;
    return 1;
  })();
  return n * mult;
}

function parseAgeToMinutes(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/([0-9]+(?:\.[0-9]+)?)\s*([smhd])\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2];
  const minutes =
    unit === 's' ? n / 60 :
    unit === 'm' ? n :
    unit === 'h' ? n * 60 :
    unit === 'd' ? n * 1440 :
    null;
  if (minutes == null) return null;
  return minutes;
}

function parsePercentLike(raw) {
  const m = String(raw ?? '').match(/(-?\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function cleanLine(line) {
  return String(line ?? '')
    .replace(/[│└├─]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFaSolPost(message) {
  const text = [message?.text, message?.caption].filter(Boolean).join('\n');
  const lines = String(text || '')
    .split('\n')
    .map(cleanLine)
    .filter(Boolean);

  const first = lines[0] || '';
  // Example: "SHALO - HarmonizedAiLifecycleOperation"
  let ticker = '';
  let tokenName = '';
  if (first) {
    const parts = first.split(' - ');
    ticker = String(parts[0] || '').trim();
    tokenName = String(parts.slice(1).join(' - ') || '').trim();
  }

  const getAfter = (prefixes) => {
    const ps = Array.isArray(prefixes) ? prefixes : [prefixes];
    for (const ln of lines) {
      for (const p of ps) {
        if (ln.toLowerCase().startsWith(String(p).toLowerCase())) {
          return ln.slice(String(p).length).trim();
        }
      }
    }
    return null;
  };

  const mc = parseUsdLike(getAfter(['MC:', 'MC']));
  const ath = parseUsdLike(getAfter(['ATH:', 'ATH']));
  const liq = parseUsdLike(getAfter(['LIQ:', 'LIQ']));
  const ageMinutes = parseAgeToMinutes(getAfter(['Age:', 'Age']));
  const vol = parseUsdLike(getAfter(['Vol:', 'Vol']));

  const txLine = getAfter(['TXs:', 'TXS:', 'Txs:']);
  const b = (() => {
    const m = String(txLine ?? '').match(/\bB\s*([0-9]+)\b/i);
    return m ? Number(m[1]) : null;
  })();
  const s = (() => {
    const m = String(txLine ?? '').match(/\bS\s*([0-9]+)\b/i);
    return m ? Number(m[1]) : null;
  })();

  const fiveMinLine = lines.find((ln) => /\b5m\b/i.test(ln)) || '';
  const fiveMinChangePct = parsePercentLike(fiveMinLine);
  const fiveMinVol = parseUsdLike((fiveMinLine.match(/\bVol\s*([^·]+)\b/i) || [])[1]);
  const makers = (() => {
    const m = fiveMinLine.match(/\bMakers\s*([0-9]+)\b/i);
    return m ? Number(m[1]) : null;
  })();

  const holdersLine = lines.find((ln) => /^Holders\b/i.test(ln)) || '';
  const holders = (() => {
    const m = holdersLine.match(/^Holders\s*([0-9]+)/i);
    return m ? Number(m[1]) : null;
  })();
  const top10Pct = parsePercentLike((holdersLine.match(/TOP\s*10:\s*([0-9.]+%)/i) || [])[1]);

  const botsLine = lines.find((ln) => /^Bots:\b/i.test(ln)) || '';
  const botsCount = (() => {
    const m = botsLine.match(/^Bots:\s*([0-9]+)/i);
    return m ? Number(m[1]) : null;
  })();
  const botsPct = parsePercentLike(botsLine);

  const snipersLine = lines.find((ln) => /^Snipers:\b/i.test(ln)) || '';
  const snipersCount = (() => {
    const m = snipersLine.match(/^Snipers:\s*([0-9]+)/i);
    return m ? Number(m[1]) : null;
  })();
  const snipersPct = parsePercentLike(snipersLine);

  const taxLine = lines.find((ln) => /\bTax\b/i.test(ln)) || '';
  const taxPct = parsePercentLike(taxLine);
  const lpPct = parsePercentLike((lines.find((ln) => /^LP:\b/i.test(ln)) || ''));
  const dexUnpaid = /\bDEX\s*Unpaid\b/i.test(lines.join(' '));

  return {
    ticker: ticker || null,
    tokenName: tokenName || null,
    stats: {
      marketCap: mc,
      ath,
      liquidity: liq,
      ageMinutes,
      volume: vol,
      fiveMinChangePct,
      fiveMinVol,
      makers,
      txBuys: Number.isFinite(b) ? b : null,
      txSells: Number.isFinite(s) ? s : null
    },
    holders: {
      holders,
      top10Pct,
      botsCount,
      botsPct,
      snipersCount,
      snipersPct
    },
    security: {
      lpPct,
      dexUnpaid,
      taxPct
    }
  };
}

function formatFaSolTelegramHtml(parsed, contractAddress) {
  const ca = String(contractAddress || '').trim();
  const t = parsed?.ticker ? `$${String(parsed.ticker).toUpperCase()}` : 'TOKEN';
  const n = parsed?.tokenName ? String(parsed.tokenName) : '';

  const st = parsed?.stats || {};
  const sec = parsed?.security || {};
  const h = parsed?.holders || {};

  const mc = st.marketCap != null ? formatUsdCompact(st.marketCap) : null;
  const liq = st.liquidity != null ? formatUsdCompact(st.liquidity) : null;
  const ath = st.ath != null ? formatUsdCompact(st.ath) : null;
  const v5 = st.fiveMinVol != null ? formatUsdCompact(st.fiveMinVol) : (st.volume != null ? formatUsdCompact(st.volume) : null);
  const age = st.ageMinutes != null ? formatAgeSeconds(st.ageMinutes) : null;

  const headline = [
    `🤖 <b>McGBot Call</b> <b>${escapeHtml(t)}</b>`,
    n ? `<i>${escapeHtml(n)}</i>` : null
  ].filter(Boolean).join('\n');

  const topLineBits = [
    mc ? `<b>MC</b> ${escapeHtml(mc)}` : null,
    liq ? `<b>Liq</b> ${escapeHtml(liq)}` : null,
    v5 ? `<b>Vol</b> ${escapeHtml(v5)}` : null,
    age ? `<b>Age</b> ${escapeHtml(age)}` : null
  ].filter(Boolean);

  const pulseBits = [
    st.fiveMinChangePct != null ? `<b>5m</b> ${escapeHtml(`${st.fiveMinChangePct > 0 ? '+' : ''}${st.fiveMinChangePct.toFixed(2)}%`)}` : null,
    (st.txBuys != null || st.txSells != null) ? `<b>TX</b> B ${escapeHtml(st.txBuys ?? '—')} / S ${escapeHtml(st.txSells ?? '—')}` : null,
    st.makers != null ? `<b>Makers</b> ${escapeHtml(st.makers)}` : null,
    ath ? `<b>ATH</b> ${escapeHtml(ath)}` : null
  ].filter(Boolean);

  const holdersBits = [
    h.holders != null ? `<b>Holders</b> ${escapeHtml(h.holders)}` : null,
    h.top10Pct != null ? `<b>Top10</b> ${escapeHtml(`${h.top10Pct.toFixed(2)}%`)}` : null,
    h.botsCount != null ? `<b>Bots</b> ${escapeHtml(h.botsCount)}${h.botsPct != null ? ` (${escapeHtml(h.botsPct.toFixed(2))}%)` : ''}` : null,
    h.snipersCount != null ? `<b>Snipers</b> ${escapeHtml(h.snipersCount)}${h.snipersPct != null ? ` (${escapeHtml(h.snipersPct.toFixed(2))}%)` : ''}` : null
  ].filter(Boolean);

  const securityBits = [
    sec.lpPct != null ? `<b>LP</b> ${escapeHtml(`${sec.lpPct.toFixed(2)}%`)}` : null,
    sec.dexUnpaid === true ? `<b>DEX</b> Unpaid` : null,
    sec.taxPct != null ? `<b>Tax</b> ${escapeHtml(`${sec.taxPct.toFixed(2)}%`)}` : null
  ].filter(Boolean);

  const sections = [];
  if (topLineBits.length) sections.push(topLineBits.join('  •  '));
  if (pulseBits.length) sections.push(pulseBits.join('  •  '));
  if (holdersBits.length) sections.push(`\n<b>Holders</b>\n${holdersBits.map(x => `• ${x}`).join('\n')}`);
  if (securityBits.length) sections.push(`\n<b>Security</b>\n${securityBits.map(x => `• ${x}`).join('\n')}`);

  return [
    headline,
    '',
    sections.join('\n'),
    '',
    `<code>${escapeHtml(ca)}</code>`,
    `<a href="${escapeHtml(dexScreenerSolUrl(ca))}">View chart</a>`
  ].filter(Boolean).join('\n');
}

/**
 * @param {{ discordBotCallsChannel: import('discord.js').TextChannel | null }} opts
 */
function startTelegramFaSolMirror(opts) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const enabled = truthyEnv(process.env.TELEGRAM_FASOL_MIRROR);
  const chatIdRaw = String(process.env.TELEGRAM_FASOL_CHAT_ID ?? '').trim();
  const wantUserRaw = String(process.env.TELEGRAM_FASOL_USERNAME ?? 'fasolcallbot')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
  const wantUser = wantUserRaw || 'fasolcallbot';

  const tgBotCalls = botCallsTelegramTarget();

  if (!enabled) {
    console.log('[TelegramFaSol] Mirror disabled (set TELEGRAM_FASOL_MIRROR=1 to enable).');
    return;
  }
  if (!token) {
    console.warn('[TelegramFaSol] TELEGRAM_FASOL_MIRROR is on but TELEGRAM_BOT_TOKEN is empty.');
    return;
  }
  if (!chatIdRaw) {
    console.warn('[TelegramFaSol] TELEGRAM_FASOL_MIRROR is on but TELEGRAM_FASOL_CHAT_ID is empty.');
    return;
  }

  const channel = opts?.discordBotCallsChannel;
  if (!channel || typeof channel.send !== 'function') {
    console.warn('[TelegramFaSol] No Discord #bot-calls channel — mirror not started.');
    return;
  }

  const chatId = Number(chatIdRaw);
  if (!Number.isFinite(chatId)) {
    console.warn('[TelegramFaSol] TELEGRAM_FASOL_CHAT_ID must be a numeric id (got non-number).');
    return;
  }

  const apiBase = `https://api.telegram.org/bot${encodeURIComponent(token)}`;
  let nextOffset = 0;
  let running = true;
  const recentMintAt = new Map();
  const DEDUPE_MS = 10 * 60 * 1000;
  const profileName = String(autoCallConfig.defaultProfile || 'balanced').trim();

  const tgBotExtra =
    tgBotCalls.chatId != null
      ? ` + TG bot-alerts ${tgBotCalls.chatId}${tgBotCalls.topicId != null ? ` topic ${tgBotCalls.topicId}` : ''}`
      : '';
  console.log(
    `[TelegramFaSol] Mirror ON — TG ingest ${chatId}, ` +
      `@${wantUser}` +
      ` → Discord #${channel.name}${tgBotExtra}`
  );

  async function clearWebhookOnce() {
    try {
      await axios.post(
        `${apiBase}/deleteWebhook`,
        { drop_pending_updates: false },
        { timeout: 15000 }
      );
    } catch (e) {
      console.warn('[TelegramFaSol] deleteWebhook:', e?.message || e);
    }
  }

  async function handleMessage(message) {
    if (!message || message.chat?.id == null) return;
    if (Number(message.chat.id) !== chatId) return;

    const uname = senderUsernameFromMessage(message);
    const senderChatId =
      message?.sender_chat?.id != null ? Number(message.sender_chat.id) : null;
    const isChannelPostFromIngest =
      senderChatId != null && Number.isFinite(senderChatId) && senderChatId === chatId;

    // In channels, Bot API updates arrive as `channel_post` and usually do NOT include `from.username`
    // for the bot that created the post. So: if this is a channel post from the ingest channel,
    // trust the chat_id match and do not require TELEGRAM_FASOL_USERNAME.
    if (!isChannelPostFromIngest) {
      if (!uname || uname !== wantUser) return;
    }
    const mints = extractMintsFromTelegramMessage(message);
    if (mints.length === 0) return;

    for (const mint of mints) {
      if (!isLikelySolanaMint(mint)) continue;

      const now = Date.now();
      const last = recentMintAt.get(mint) || 0;
      if (now - last < DEDUPE_MS) continue;
      recentMintAt.set(mint, now);

      const existing = getTrackedCall(mint);
      if (existing && existing.isActive !== false) {
        console.log(`[TelegramFaSol] Skip ${mint.slice(0, 6)}… — already tracked active.`);
        continue;
      }

      const parsed = parseFaSolPost(message);
      const scan = {
        alertType: 'FaSol Call',
        contractAddress: mint,
        tokenName: parsed?.tokenName || parsed?.ticker || mint.slice(0, 6),
        ticker: parsed?.ticker || '',
        marketCap: parsed?.stats?.marketCap ?? null,
        liquidity: parsed?.stats?.liquidity ?? null,
        volume5m: parsed?.stats?.fiveMinVol ?? parsed?.stats?.volume ?? null,
        ageMinutes: parsed?.stats?.ageMinutes ?? null,
        holders: parsed?.holders?.holders ?? null
      };

      console.log(`[TelegramFaSol] Mirror post ${scan.ticker || mint.slice(0, 6)} (${profileName})`);
      await postBotCallScan(channel, scan, profileName);

      // Send a richer TG mirror using the FaSol-provided stats (with your custom buttons).
      const { chatId: outChatId, topicId: outTopicId } = botCallsTelegramTarget();
      if (outChatId != null) {
        const buttonsRaw = process.env.TELEGRAM_BOT_CALLS_BUTTONS;
        const replyMarkup = buildInlineKeyboardFromButtons(parseTelegramButtons(buttonsRaw), { ca: mint });
        await sendTelegramMessage({
          chatId: outChatId,
          messageThreadId: outTopicId,
          text: formatFaSolTelegramHtml(parsed, mint),
          parseMode: 'HTML',
          replyMarkup: replyMarkup || undefined,
          disableWebPreview: true,
          logLabel: 'bot-calls TG fasol'
        });
      } else {
        await mirrorBotCallToTelegram(scan);
      }
    }
  }

  async function pollLoop() {
    while (running) {
      try {
        const res = await axios.get(`${apiBase}/getUpdates`, {
          params: {
            offset: nextOffset > 0 ? nextOffset : undefined,
            timeout: 25,
            // Some groups/forums/channels deliver bot posts as `channel_post` instead of `message`.
            allowed_updates: JSON.stringify(['message', 'channel_post', 'edited_message', 'edited_channel_post'])
          },
          timeout: 35000
        });
        const data = res.data;
        if (!data || data.ok !== true) {
          throw new Error(data?.description || 'getUpdates not ok');
        }
        const updates = Array.isArray(data.result) ? data.result : [];
        for (const u of updates) {
          if (typeof u?.update_id === 'number') nextOffset = u.update_id + 1;
          if (u.message) await handleMessage(u.message);
          if (u.channel_post) await handleMessage(u.channel_post);
          if (u.edited_message) await handleMessage(u.edited_message);
          if (u.edited_channel_post) await handleMessage(u.edited_channel_post);
        }
      } catch (e) {
        console.error('[TelegramFaSol] poll:', e?.message || e);
        await sleep(4000);
      }
    }
  }

  void (async () => {
    await clearWebhookOnce();
    await pollLoop();
  })().catch((e) => console.error('[TelegramFaSol] fatal:', e?.message || e));

  return () => {
    running = false;
  };
}

module.exports = { startTelegramFaSolMirror };
