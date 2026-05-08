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

// In-process "ask FaSol for stats" enrichment for user calls.
// We piggyback on the same getUpdates poll loop: when a FaSol post containing a mint arrives,
// we resolve any pending requests for that mint.
const pendingEnrichment = new Map(); // mintLower -> [{ resolve, reject, expiresAt }]

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

async function requestFaSolEnrichment(contractAddress, opts = {}) {
  const ca = String(contractAddress || '').trim();
  if (!isLikelySolanaMint(ca)) {
    throw new Error('Invalid contract address');
  }

  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const chatIdRaw = String(process.env.TELEGRAM_FASOL_CHAT_ID ?? '').trim();
  const chatId = Number(chatIdRaw);
  if (!token || !Number.isFinite(chatId)) {
    throw new Error('Telegram ingest not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_FASOL_CHAT_ID)');
  }

  const timeoutMs = Math.max(2_000, Math.min(60_000, Number(opts.timeoutMs || 15_000)));
  const mintKey = ca.toLowerCase();
  const expiresAt = Date.now() + timeoutMs;

  const p = new Promise((resolve, reject) => {
    const arr = pendingEnrichment.get(mintKey) || [];
    arr.push({ resolve, reject, expiresAt });
    pendingEnrichment.set(mintKey, arr);
    setTimeout(() => {
      const cur = pendingEnrichment.get(mintKey) || [];
      const next = cur.filter((x) => x.expiresAt > Date.now() && x.resolve !== resolve);
      if (next.length) pendingEnrichment.set(mintKey, next);
      else pendingEnrichment.delete(mintKey);
      reject(new Error('timeout'));
    }, timeoutMs + 250);
  });

  // Trigger FaSol by posting the CA into the ingest channel/group.
  const apiBase = `https://api.telegram.org/bot${encodeURIComponent(token)}`;
  await axios
    .post(
      `${apiBase}/sendMessage`,
      { chat_id: chatId, text: ca, disable_web_page_preview: true },
      { timeout: 15000 }
    )
    .catch((e) => {
      const desc = e?.response?.data?.description || e?.message || e;
      throw new Error(`sendMessage failed: ${desc}`);
    });

  return p;
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
  const vol = st.fiveMinVol != null ? formatUsdCompact(st.fiveMinVol) : (st.volume != null ? formatUsdCompact(st.volume) : null);
  const age = st.ageMinutes != null ? formatAgeSeconds(st.ageMinutes) : null;
  const ch5 =
    st.fiveMinChangePct != null
      ? `${st.fiveMinChangePct > 0 ? '+' : ''}${st.fiveMinChangePct.toFixed(2)}%`
      : null;
  const tx =
    st.txBuys != null || st.txSells != null
      ? `B ${st.txBuys ?? '—'}  S ${st.txSells ?? '—'}`
      : null;

  const titleLine = `🔔 <b>McGBot Call</b> · <b>${escapeHtml(t)}</b>`;
  const nameLine = n ? `🪙 <i>${escapeHtml(n)}</i>` : null;

  const statLines = [
    ['MC', mc],
    ['ATH', ath],
    ['LIQ', liq],
    ['AGE', age],
    ['VOL', vol],
    ['TX', tx],
    ['5M', ch5],
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
    if (h.snipersCount != null) parts.push(`Snipers ${h.snipersCount}${h.snipersPct != null ? ` (${h.snipersPct.toFixed(2)}%)` : ''}`);
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
    titleLine,
    nameLine,
    statsPre,
    holdersLine,
    securityLine,
    '',
    `CA: <code>${escapeHtml(ca)}</code>`,
    `<a href="${escapeHtml(dexScreenerSolUrl(ca))}">DexScreener</a>`
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

      // If this message looks like a FaSol stats card, resolve any pending enrichment waits.
      try {
        const parsedMaybe = parseFaSolPost(message);
        const hasStats =
          parsedMaybe &&
          (parsedMaybe?.stats?.marketCap != null ||
            parsedMaybe?.stats?.liquidity != null ||
            parsedMaybe?.stats?.volume != null ||
            parsedMaybe?.stats?.fiveMinVol != null);
        if (hasStats) {
          const key = mint.toLowerCase();
          const pending = pendingEnrichment.get(key);
          if (pending && pending.length) {
            pendingEnrichment.delete(key);
            for (const waiter of pending) {
              if (waiter.expiresAt > Date.now()) {
                waiter.resolve({ mint, parsed: parsedMaybe, message });
              }
            }
          }
        }
      } catch (_) {
        // ignore parse failures for enrichment resolution
      }

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
        __mirrorSource: 'telegram',
        contractAddress: mint,
        tokenName: parsed?.tokenName || parsed?.ticker || mint.slice(0, 6),
        ticker: parsed?.ticker || '',
        marketCap: parsed?.stats?.marketCap ?? null,
        ath: parsed?.stats?.ath ?? null,
        liquidity: parsed?.stats?.liquidity ?? null,
        volume5m: parsed?.stats?.fiveMinVol ?? parsed?.stats?.volume ?? null,
        ageMinutes: parsed?.stats?.ageMinutes ?? null,
        holders: parsed?.holders?.holders ?? null,
        top10Pct: parsed?.holders?.top10Pct ?? null,
        botsCount: parsed?.holders?.botsCount ?? null,
        snipersCount: parsed?.holders?.snipersCount ?? null,
        fiveMinChangePct: parsed?.stats?.fiveMinChangePct ?? null,
        makers: parsed?.stats?.makers ?? null,
        txBuys: parsed?.stats?.txBuys ?? null,
        txSells: parsed?.stats?.txSells ?? null,
        lpPct: parsed?.security?.lpPct ?? null,
        dexUnpaid: parsed?.security?.dexUnpaid ?? null,
        taxPct: parsed?.security?.taxPct ?? null
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

module.exports = { startTelegramFaSolMirror, requestFaSolEnrichment };
