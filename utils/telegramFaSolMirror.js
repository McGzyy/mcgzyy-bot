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
const { generateRealScan } = require('./scannerEngine');
const { postBotCallScan } = require('./autoCallEngine');
const { autoCallConfig } = require('../config/autoCallConfig');
const { getTrackedCall } = require('./trackedCallsService');
const { mirrorBotCallToTelegram, botCallsTelegramTarget } = require('./telegramAlerts');

const MINT_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

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
    const m = text.match(MINT_RE);
    if (m) for (const x of m) out.add(x);
  }

  const entities = [...(message?.entities || []), ...(message?.caption_entities || [])];
  const src = message?.text || message?.caption || '';
  for (const ent of entities) {
    if (!ent || typeof ent.offset !== 'number' || typeof ent.length !== 'number') continue;
    const slice = src.slice(ent.offset, ent.offset + ent.length);
    if (ent.type === 'url' || ent.type === 'text_link') {
      const url = ent.type === 'text_link' ? ent.url : slice;
      if (typeof url === 'string') {
        const mm = url.match(MINT_RE);
        if (mm) for (const x of mm) out.add(x);
      }
    }
    if (slice && isLikelySolanaMint(slice)) out.add(slice.trim());
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

/**
 * @param {{ discordBotCallsChannel: import('discord.js').TextChannel | null }} opts
 */
function startTelegramFaSolMirror(opts) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const enabled = truthyEnv(process.env.TELEGRAM_FASOL_MIRROR);
  const chatIdRaw = String(process.env.TELEGRAM_FASOL_CHAT_ID ?? '').trim();
  // If TELEGRAM_FASOL_USERNAME is empty, accept any sender (useful for debugging).
  const wantUserRaw = String(process.env.TELEGRAM_FASOL_USERNAME ?? '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
  const wantUser = wantUserRaw || null;

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
      (wantUser ? `@${wantUser}` : '(any sender)') +
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
    if (wantUser) {
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

      let scan;
      try {
        scan = await generateRealScan(mint);
      } catch (e) {
        console.error('[TelegramFaSol] generateRealScan failed:', mint.slice(0, 8), e?.message || e);
        continue;
      }
      if (!scan || !scan.contractAddress || scan.__monitorProviderSkip === true) {
        console.warn('[TelegramFaSol] Skip — no scan for', mint.slice(0, 8));
        continue;
      }

      console.log(`[TelegramFaSol] Mirror post ${scan.ticker || mint.slice(0, 6)} (${profileName})`);
      await postBotCallScan(channel, scan, profileName);
      await mirrorBotCallToTelegram(scan);
    }
  }

  async function pollLoop() {
    while (running) {
      try {
        const res = await axios.get(`${apiBase}/getUpdates`, {
          params: {
            offset: nextOffset > 0 ? nextOffset : undefined,
            timeout: 25,
            allowed_updates: JSON.stringify(['message'])
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
