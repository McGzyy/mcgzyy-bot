/**
 * Telegram → Discord bot-call mirror (FaSol private group).
 *
 * Env (mcgzyy-bot/.env or repo .env):
 *   TELEGRAM_BOT_TOKEN           — McGBot Telegram bot (@McGzyyBot) token
 *   TELEGRAM_FASOL_MIRROR        — set to "1" / "true" / "yes" to enable
 *   TELEGRAM_FASOL_ENRICH_USER_CALLS — optional "1" = poll ingest when TELEGRAM_FASOL_MIRROR is off but you still want !call enrich
 *   TELEGRAM_FASOL_INGEST_TOPIC_ID — optional forum topic id when posting the CA trigger (same chat as TELEGRAM_FASOL_CHAT_ID)
 *   TELEGRAM_FASOL_CHAT_ID       — numeric chat id of the private FaSol group (often negative for supergroups)
 *   TELEGRAM_FASOL_INGEST_CHAT_ID — alias for TELEGRAM_FASOL_CHAT_ID if the latter is empty
 *   TELEGRAM_FASOL_ENRICH_TIMEOUT_MS — optional; !call / dashboard waits for FaSol (default 28000). Runs in parallel with Dex.
 *   TELEGRAM_FASOL_USERNAME      — optional, comma-separated FaSol bot @usernames (default: fasolcallbot,fasolbot)
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
  sendTelegramPhoto,
  pickTelegramTokenPhotoUrl,
  formatFaSolTelegramHtml
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

/** TELEGRAM_FASOL_USERNAME — comma-separated @handles (default includes common FaSol bot names). */
function faSolAllowedUsernames() {
  const raw = String(process.env.TELEGRAM_FASOL_USERNAME ?? 'fasolcallbot,fasolbot')
    .split(/[,;]+/)
    .map(s => s.replace(/^@/, '').trim().toLowerCase())
    .filter(Boolean);
  return new Set(raw.length ? raw : ['fasolcallbot', 'fasolbot']);
}

/** Match MC/ATH/LIQ when not at line start (emoji headers, tree lines). */
function parseUsdLabeled(lines, labelRe) {
  for (const ln of lines) {
    const m = ln.match(labelRe);
    if (m && m[1]) {
      const v = parseUsdLike(m[1]);
      if (v != null) return v;
    }
  }
  return null;
}

function parseFaSolPost(message) {
  const text = [message?.text, message?.caption].filter(Boolean).join('\n');
  const lines = String(text || '')
    .split('\n')
    .map(cleanLine)
    .filter(Boolean);

  const first = lines[0] || '';
  // Examples: "$FMJ - Flying Mayonnaise Jars", "🌙 $FMJ - Flying Mayonnaise Jars"
  let ticker = '';
  let tokenName = '';
  if (first) {
    const moon = first.match(/\$([A-Za-z0-9]{1,24})\s*[-–—]\s*(.+)$/);
    if (moon) {
      ticker = moon[1].trim();
      tokenName = moon[2].trim();
    } else {
      const parts = first.split(/\s*[-–—]\s*/);
      const head = String(parts[0] || '')
        .replace(/^[\s🌙⌛🔔🪙📊]+/, '')
        .replace(/^\$\s*/, '')
        .trim();
      ticker = head.replace(/^\$/, '').trim();
      tokenName = String(parts.slice(1).join(' - ') || '').trim();
    }
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

  let mc = parseUsdLike(getAfter(['MC:', 'MC']));
  if (mc == null) {
    mc = parseUsdLabeled(lines, /\bMC\b\s*:?\s*(\$?\s*[0-9]+(?:\.[0-9]+)?\s*[kKmMbB]?)/i);
  }
  let ath = parseUsdLike(getAfter(['ATH:', 'ATH']));
  if (ath == null) {
    ath = parseUsdLabeled(lines, /\bATH\b\s*:?\s*(\$?\s*[0-9]+(?:\.[0-9]+)?\s*[kKmMbB]?)/i);
  }
  let liq = parseUsdLike(getAfter(['LIQ:', 'LIQ']));
  if (liq == null) {
    liq = parseUsdLabeled(lines, /\bLIQ\b\s*:?\s*(\$?\s*[0-9]+(?:\.[0-9]+)?\s*[kKmMbB]?)/i);
  }
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

  const holdersLine = lines.find((ln) => /\bHolders\b/i.test(ln)) || '';
  const holders = (() => {
    const m = holdersLine.match(/\bHolders\s+(\d+)/i);
    return m ? Number(m[1]) : null;
  })();
  const top10Pct = parsePercentLike(
    (holdersLine.match(/TOP\s*10\s*:\s*([0-9.]+%)/i) || [])[1] ||
      (holdersLine.match(/TOP\s*10\s*([0-9.]+%)/i) || [])[1]
  );

  const botsLine = lines.find((ln) => /\bBots\s*:\s*[0-9]/i.test(ln)) || '';
  const botsCount = (() => {
    const m = botsLine.match(/\bBots\s*:\s*([0-9]+)/i);
    return m ? Number(m[1]) : null;
  })();
  const botsPct = parsePercentLike(botsLine);

  const snipersLine = lines.find((ln) => /\bSnipers\s*:\s*[0-9]/i.test(ln)) || '';
  const snipersCount = (() => {
    const m = snipersLine.match(/\bSnipers\s*:\s*([0-9]+)/i);
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

function normalizeMintCore(ca) {
  const raw = String(ca || '').trim();
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}pump$/i.test(raw)) return raw.slice(0, -4);
  return raw;
}

function canonicalMintKey(ca) {
  return normalizeMintCore(ca).toLowerCase();
}

/** Numeric Telegram chat id for FaSol ingest (group / forum / channel). */
function getFaSolIngestChatIdRaw() {
  const raw =
    String(process.env.TELEGRAM_FASOL_CHAT_ID ?? '').trim() ||
    String(process.env.TELEGRAM_FASOL_INGEST_CHAT_ID ?? '').trim();
  return raw;
}

async function requestFaSolEnrichment(contractAddress, opts = {}) {
  const rawCa = String(contractAddress || '').trim();
  const core = normalizeMintCore(rawCa);
  if (!isLikelySolanaMint(core)) {
    throw new Error('Invalid Solana contract address');
  }

  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const chatIdRaw = getFaSolIngestChatIdRaw();
  const chatId = Number(chatIdRaw);
  if (!token || !Number.isFinite(chatId)) {
    throw new Error(
      'Telegram ingest not configured (need TELEGRAM_BOT_TOKEN and TELEGRAM_FASOL_CHAT_ID or TELEGRAM_FASOL_INGEST_CHAT_ID)'
    );
  }

  const timeoutMs = Math.max(2_000, Math.min(60_000, Number(opts.timeoutMs || 15_000)));
  const mintKey = canonicalMintKey(rawCa);
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

  // Trigger FaSol by posting the CA into the ingest channel/group (keep pump suffix if present).
  const apiBase = `https://api.telegram.org/bot${encodeURIComponent(token)}`;
  const topicRaw = String(process.env.TELEGRAM_FASOL_INGEST_TOPIC_ID ?? '').trim();
  const ingestTopicId = topicRaw ? Number(topicRaw) : null;
  const body = {
    chat_id: chatId,
    text: rawCa,
    disable_web_page_preview: true
  };
  if (ingestTopicId != null && Number.isFinite(ingestTopicId) && ingestTopicId > 0) {
    body.message_thread_id = Math.floor(ingestTopicId);
  }

  try {
    console.log(
      `[UserCall/FaSolEnrich] Posting CA to FaSol ingest chat ${chatId}` +
        `${body.message_thread_id ? ` topic ${body.message_thread_id}` : ''} …`
    );
    const sm = await axios.post(`${apiBase}/sendMessage`, body, { timeout: 15000 });
    if (sm?.data?.ok !== true) {
      throw new Error(sm?.data?.description || 'sendMessage ok=false');
    }
  } catch (e) {
    const tg = e?.response?.data;
    const desc =
      (tg && typeof tg === 'object' ? tg.description : null) || e?.message || String(e);
    const hint =
      /thread/i.test(String(desc)) || /topic/i.test(String(desc))
        ? ' — set TELEGRAM_FASOL_INGEST_TOPIC_ID to the forum topic id where FaSol listens.'
        : '';
    console.error('[UserCall/FaSolEnrich] sendMessage failed:', desc, tg?.error_code ?? '', hint);
    throw new Error(`sendMessage failed: ${desc}${hint}`);
  }

  console.log(
    `[UserCall/FaSolEnrich] Posted CA to ingest chat ${chatId}${body.message_thread_id ? ` topic ${body.message_thread_id}` : ''}`
  );

  return p;
}

/**
 * @param {{ discordBotCallsChannel: import('discord.js').TextChannel | null }} opts
 */
function startTelegramFaSolMirror(opts) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const mirrorEnabled = truthyEnv(process.env.TELEGRAM_FASOL_MIRROR);
  const enrichListener = truthyEnv(process.env.TELEGRAM_FASOL_ENRICH_USER_CALLS);
  const enabled = mirrorEnabled || enrichListener;
  const chatIdRaw = getFaSolIngestChatIdRaw();
  const faSolUsers = faSolAllowedUsernames();

  const tgBotCalls = botCallsTelegramTarget();

  if (!enabled) {
    console.log(
      '[TelegramFaSol] Ingest idle — enable TELEGRAM_FASOL_MIRROR and/or TELEGRAM_FASOL_ENRICH_USER_CALLS.'
    );
    return;
  }
  if (!token) {
    console.warn('[TelegramFaSol] TELEGRAM_BOT_TOKEN is empty — ingest listener not started.');
    return;
  }
  if (!chatIdRaw) {
    console.warn('[TelegramFaSol] TELEGRAM_FASOL_CHAT_ID is empty — ingest listener not started.');
    return;
  }

  const channel = opts?.discordBotCallsChannel;
  if (mirrorEnabled && (!channel || typeof channel.send !== 'function')) {
    console.warn(
      '[TelegramFaSol] Mirror enabled but no Discord #bot-calls channel — FaSol→Discord mirror disabled. ' +
        'Ingest listener still runs so !call / dashboard enrichment can receive FaSol replies.'
    );
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
  const modeBits = [];
  if (mirrorEnabled) modeBits.push('mirror→Discord');
  if (enrichListener) modeBits.push('user-call enrich');
  console.log(
    `[TelegramFaSol] Ingest ON (${modeBits.join(' + ')}) — TG chat ${chatId}, FaSol usernames: ${[...faSolUsers].join(', ')}` +
      (mirrorEnabled && channel ? ` → Discord #${channel.name}${tgBotExtra}` : '')
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
      if (!uname || !faSolUsers.has(uname)) return;
    }
    const mints = extractMintsFromTelegramMessage(message);
    if (mints.length === 0) return;

    for (const mint of mints) {
      if (!isLikelySolanaMint(mint)) continue;

      /** FaSol reply to our ingest CA — belongs on user-call feeds only; skip bot-call mirror (Discord + TG). */
      let skipMirrorForUserEnrich = false;

      // If this message looks like a FaSol stats card, resolve any pending enrichment waits.
      try {
        const parsedMaybe = parseFaSolPost(message);
        const enrichable =
          parsedMaybe &&
          (parsedMaybe.stats?.marketCap != null ||
            parsedMaybe.stats?.liquidity != null ||
            parsedMaybe.stats?.ath != null ||
            parsedMaybe.stats?.volume != null ||
            parsedMaybe.stats?.fiveMinVol != null ||
            parsedMaybe.stats?.fiveMinChangePct != null ||
            parsedMaybe.stats?.makers != null ||
            parsedMaybe.holders?.holders != null ||
            (parsedMaybe.ticker && parsedMaybe.tokenName));
        if (enrichable) {
          const key = canonicalMintKey(mint);
          const pending = pendingEnrichment.get(key);
          if (pending && pending.length) {
            skipMirrorForUserEnrich = true;
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

      if (skipMirrorForUserEnrich) {
        console.log(
          `[TelegramFaSol] Skip bot-call mirror for ${mint.slice(0, 6)}… — FaSol reply matched !call/dashboard enrich`
        );
        continue;
      }

      if (!mirrorEnabled || !channel || typeof channel.send !== 'function') {
        continue;
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
        volume1h:
          parsed?.stats?.fiveMinVol != null && parsed?.stats?.volume != null
            ? parsed.stats.volume
            : null,
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
        taxPct: parsed?.security?.taxPct ?? null,
        __faSolParsed: parsed && typeof parsed === 'object' ? parsed : null
      };

      console.log(`[TelegramFaSol] Mirror post ${scan.ticker || mint.slice(0, 6)} (${profileName})`);
      await postBotCallScan(channel, scan, profileName);

      // Send a richer TG mirror using the FaSol-provided stats (with your custom buttons).
      const { chatId: outChatId, topicId: outTopicId } = botCallsTelegramTarget();
      if (outChatId != null) {
        const buttonsRaw = process.env.TELEGRAM_BOT_CALLS_BUTTONS;
        const replyMarkup = buildInlineKeyboardFromButtons(parseTelegramButtons(buttonsRaw), { ca: mint });
        const caption = formatFaSolTelegramHtml(parsed, mint, { variant: 'bot' });
        const photoUrl = pickTelegramTokenPhotoUrl(mint, scan);
        if (photoUrl) {
          const ok = await sendTelegramPhoto({
            chatId: outChatId,
            messageThreadId: outTopicId,
            photoUrl,
            caption,
            parseMode: 'HTML',
            replyMarkup: replyMarkup || undefined,
            logLabel: 'bot-calls TG fasol+photo'
          });
          if (ok) continue;
        }
        await sendTelegramMessage({
          chatId: outChatId,
          messageThreadId: outTopicId,
          text: caption,
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
