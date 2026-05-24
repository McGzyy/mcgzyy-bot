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
 *   TELEGRAM_FASOL_OUTSIDE_CHAT_ID — optional separate supergroup for Outside Calls: McGBot posts CA here, FaSol replies
 *     (reply_to McGBot’s CA). `requestFaSolEnrichmentOutside()` + DB row insert into `outside_calls` (needs SUPABASE_SERVICE_ROLE_KEY).
 *   TELEGRAM_FASOL_OUTSIDE_INGEST_TOPIC_ID — optional forum topic id in that outside group
 *   TELEGRAM_FASOL_ENRICH_TIMEOUT_MS — optional; !call / dashboard waits for FaSol (default 28000). Runs in parallel with Dex.
 *   TELEGRAM_FASOL_USERNAME      — optional, comma-separated FaSol bot @usernames (default: fasolcallbot,fasolbot)
 *   TELEGRAM_BOT_CALLS_CHANNEL_ID — members TG hub: bot-call lines after FaSol mirror (see utils/telegramAlerts.js)
 *   TELEGRAM_BOT_CALLS_TOPIC_ID   — optional forum topic id for that channel
 *   TELEGRAM_CA_ANALYZER_CHAT_ID  — optional supergroup/channel for dashboard “CA Analyzer”: McGBot posts mint, FaSol replies;
 *     same getUpdates loop resolves `requestCaAnalyzerFaSolEnrichment()` (often `-100…` format).
 *   TELEGRAM_CA_ANALYZER_TOPIC_ID — optional forum topic id in that channel
 *
 * `parseFaSolPost()` is the single canonical parse for FaSol Telegram cards; the same object is attached as
 * `scan.__faSolParsed` for Discord→TG user calls, bot-call mirrors, outside ingest, and the dashboard CA Analyzer.
 *
 * Flow: FaSol group → generateRealScan → Discord #bot-calls (full embed) → TG bot-call line if CHANNEL_ID set.
 *
 * McGBot Telegram: BotFather → Group privacy OFF so the bot receives all messages in the group.
 */
const axios = require('axios');
const { insertOutsideCallRow } = require('./outsideCallsSupabaseIngest');
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

/** McGBot CA posts in user ingest chat → skip FaSol mirror when FaSol replies to these ids. */
const pendingUserIngestByTriggerId = new Map(); // message_id -> { mintKey, expiresAt }

/** Outside ingest: `sendMessage` id in the outside group → wait for FaSol `reply_to_message` + insert `outside_calls`. */
const pendingOutsideByTriggerId = new Map(); // trigger message_id -> { sourceId, mint, tweetId, xPostUrl, mintResolution, signalTicker, resolve, reject, timer }

function pruneExpiredUserIngestTriggers(now = Date.now()) {
  for (const [id, row] of pendingUserIngestByTriggerId.entries()) {
    if (!row || row.expiresAt <= now) pendingUserIngestByTriggerId.delete(id);
  }
}

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
  const m = String(raw ?? '').match(/([+-]?\d+(?:\.\d+)?)\s*%/);
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

/**
 * FaSol cards often start with a bot/header line ("McGBot Calls - Filter 1") and put the real token on the next line
 * ("$BTW - …"). Prefer the first `$TICKER — name` row that is not alert-meta noise.
 */
function parseFaSolTokenHeader(lines) {
  const noiseTicker = /^(MCGBOT|MCGBOTCALLS|FILTER|CALLS|ALERT|FASOL|BOT|SCANNER)$/i;
  const noiseName = /^(McGBot\s+Calls|Filter\s*\d+|Calls\s*-\s*Filter)/i;

  for (const raw of lines) {
    const ln = String(raw || '').trim();
    if (!ln) continue;
    const moon = ln.match(/\$([A-Za-z0-9]{1,20})\s*[-–—]\s*(.+)$/);
    if (!moon) continue;
    const t = moon[1].trim();
    const n = moon[2].trim();
    if (!t || !n) continue;
    if (noiseTicker.test(t)) continue;
    if (noiseName.test(n)) continue;
    if (/mcgbot/i.test(t) && /call/i.test(t)) continue;
    if (/^filter\s*\d/i.test(n)) continue;
    return { ticker: t, tokenName: n };
  }

  const first = lines[0] || '';
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
  return { ticker, tokenName };
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

/**
 * FaSol TX lines use ASCII B/S or circled / negative-circled letters, e.g.
 * `TXs: 🅑 1.32K Ⓢ 1.12K` (U+1F151, U+24C8) or `B 1.32K · S 1.12K`.
 * @returns {{ buys: number|null, sells: number|null }}
 */
function parseTxBuysSellsFromFragment(fragment) {
  const text = String(fragment ?? '').trim();
  if (!text) return { buys: null, sells: null };
  // FaSol: ASCII B/S, circled B (U+24B7), negative circled B (U+1F151 = \uD83C\uDD51), circled S (U+24C8)
  const buyRe =
    /(?:^|[\s·•|])(?:\uD83C\uDD51|\u24B7|B)\s*((?:\$)?\s*[0-9]+(?:\.[0-9]+)?\s*[kKmMbB]?)/iu;
  const sellRe = /(?:^|[\s·•|])(?:\u24C8|S)\s*((?:\$)?\s*[0-9]+(?:\.[0-9]+)?\s*[kKmMbB]?)/iu;
  const pick = (re) => {
    const m = text.match(re);
    if (!m || !m[1]) return null;
    const n = parseUsdLike(m[1]);
    return Number.isFinite(n) ? Math.round(n) : null;
  };
  return { buys: pick(buyRe), sells: pick(sellRe) };
}

function parseFaSolPost(message) {
  const text = [message?.text, message?.caption].filter(Boolean).join('\n');
  const lines = String(text || '')
    .split('\n')
    .map(cleanLine)
    .filter(Boolean);

  const { ticker, tokenName } = parseFaSolTokenHeader(lines);

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
  let ageMinutes = parseAgeToMinutes(getAfter(['Age:', 'Age']));
  if (ageMinutes == null) {
    for (const ln of lines) {
      const am = ln.match(/\bAge\s*:?\s*(.+)$/i);
      if (am && am[1]) {
        ageMinutes = parseAgeToMinutes(String(am[1]).trim());
        if (ageMinutes != null) break;
      }
    }
  }
  const vol = parseUsdLike(getAfter(['Vol:', 'Vol']));

  let txTail = getAfter(['TXs:', 'TXS:', 'Txs:', 'TX:']);
  if (!txTail) {
    const txRow = lines.find((ln) => /\btxs?\s*:/i.test(ln));
    if (txRow) {
      const m = txRow.match(/\btxs?\s*:?\s*(.+)$/i);
      txTail = m ? String(m[1]).trim() : '';
    }
  }
  const { buys: b, sells: s } = parseTxBuysSellsFromFragment(txTail);

  const fiveMinLine =
    lines.find((ln) => /\b5m\b/i.test(ln)) ||
    lines.find((ln) => /\b5M\b/.test(ln) && /vol|makers/i.test(ln)) ||
    '';
  let fiveMinChangePct = parsePercentLike(fiveMinLine);
  let fiveMinChangeIsInfinity = false;
  if (fiveMinChangePct == null && /\binfinity\b/i.test(fiveMinLine)) {
    fiveMinChangeIsInfinity = true;
  }
  const volBit = (fiveMinLine.match(/\bVol\s*([^·•]+?)(?=\s*[·•]|\s+Makers\b|$)/i) || [])[1];
  let fiveMinVol = parseUsdLike(String(volBit ?? '').trim());
  if (fiveMinVol == null && fiveMinLine) {
    const vm = fiveMinLine.match(/\bVol\s*(\$?\s*[0-9]+(?:\.[0-9]+)?\s*[kKmMbB]?)/i);
    if (vm && vm[1]) fiveMinVol = parseUsdLike(vm[1].trim());
  }
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

  const freshLine = lines.find((ln) => /\bFresh\s*:/i.test(ln)) || '';
  const freshM = freshLine.match(/\bFresh\s*:?\s*([0-9]+)(?:\s*[·•]\s*([0-9.]+)%)?/i);
  const freshCount = freshM && freshM[1] ? Number(freshM[1]) : null;
  const freshPct =
    freshM && freshM[2] != null && freshM[2] !== '' ? parsePercentLike(`${freshM[2]}%`) : null;

  const bundlersLine = lines.find((ln) => /\bBundlers\s*:/i.test(ln)) || '';
  const bundM = bundlersLine.match(/\bBundlers\s*:?\s*([0-9]+)(?:\s*[·•]\s*([0-9.]+)%)?/i);
  const bundlersCount = bundM && bundM[1] ? Number(bundM[1]) : null;
  const bundlersPct =
    bundM && bundM[2] != null && bundM[2] !== '' ? parsePercentLike(`${bundM[2]}%`) : null;

  let devHoldPct = null;
  for (const ln of lines) {
    const d =
      ln.match(/\bDev\s*H\s*(?:\([^)]*\))?\s*:?\s*([0-9.]+%)/i) ||
      ln.match(/\bDev\s+Holding\s*:?\s*([0-9.]+%)/i);
    if (d && d[1]) {
      devHoldPct = parsePercentLike(d[1]);
      break;
    }
  }

  const lpLine = lines.find((ln) => /\bLP\s*:/i.test(ln)) || '';
  const lpPct = (() => {
    const m = lpLine.match(/\bLP\s*:?\s*([0-9.]+%)/i);
    if (m && m[1]) return parsePercentLike(m[1]);
    return parsePercentLike(lpLine);
  })();
  const taxPct = (() => {
    for (const ln of lines) {
      const m =
        ln.match(/\bTax\s*:?\s*([0-9.]+%)/i) ||
        ln.match(/\bTax\s+([0-9.]+%)/i) ||
        ln.match(/·\s*Tax\s*([0-9.]+%)/i);
      if (m && m[1]) return parsePercentLike(m[1]);
    }
    return null;
  })();
  const joinedLines = lines.join('\n');
  const dexUnpaid = /\bDEX\s*Unpaid\b/i.test(joinedLines);
  const dexPaid = /\bDEX\s*Paid\b/i.test(joinedLines);

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
      fiveMinChangeIsInfinity: fiveMinChangeIsInfinity ? true : undefined,
      fiveMinVol,
      makers,
      txBuys: b != null && Number.isFinite(b) ? b : null,
      txSells: s != null && Number.isFinite(s) ? s : null
    },
    holders: {
      holders,
      top10Pct,
      botsCount,
      botsPct,
      snipersCount,
      snipersPct,
      freshCount,
      freshPct,
      bundlersCount,
      bundlersPct,
      devHoldPct
    },
    security: {
      lpPct,
      dexUnpaid,
      dexPaid: dexPaid ? true : undefined,
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

/**
 * Discord mirror must use a full `generateRealScan` payload so `createAutoCallEmbed` + chart hydrate
 * have momentum / risk / ratios / pair / correct token names. If scan fails, fall back to minimal FaSol parse
 * (compact mirror embed).
 */
async function buildScanForDiscordMirror(mint, parsed) {
  const { generateRealScan } = require('./scannerEngine');

  const minimalScan = () => ({
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
  });

  try {
    const real = await generateRealScan(mint);
    if (real && typeof real === 'object' && String(real.contractAddress || '').trim()) {
      return {
        ...real,
        __faSolParsed: parsed && typeof parsed === 'object' ? parsed : null
      };
    }
  } catch (e) {
    console.warn('[TelegramFaSol] generateRealScan for mirror failed:', mint.slice(0, 8), e?.message || e);
  }

  return minimalScan();
}

/** Numeric Telegram chat id for FaSol ingest (group / forum / channel). */
function getFaSolIngestChatIdRaw() {
  const raw =
    String(process.env.TELEGRAM_FASOL_CHAT_ID ?? '').trim() ||
    String(process.env.TELEGRAM_FASOL_INGEST_CHAT_ID ?? '').trim();
  return raw;
}

function getFaSolOutsideIngestChatIdRaw() {
  return String(process.env.TELEGRAM_FASOL_OUTSIDE_CHAT_ID ?? '').trim();
}

/** Dedicated Telegram chat for dashboard CA Analyzer (FaSol enrich only; no Discord mirror). */
function getCaAnalyzerChatIdRaw() {
  return String(process.env.TELEGRAM_CA_ANALYZER_CHAT_ID ?? '').trim();
}

/**
 * Trim/BOM/quotes and map bare positive supergroup/channel fragments to Bot API form (`-100…`).
 * Already-negative ids are unchanged. Intended for group/channel env vars (not DM user ids).
 * @param {string} raw
 * @returns {{ chatId: number; normalizedFromPositive?: boolean } | null}
 */
function normalizeTelegramSupergroupChatIdForBotApi(raw) {
  const s = String(raw ?? '')
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/^['"]|['"]$/g, '');
  if (!s || !/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n > 0 && n < 1e12) {
    return { chatId: -(1_000_000_000_000 + n), normalizedFromPositive: true };
  }
  return { chatId: n };
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
    const triggerId = sm?.data?.result?.message_id;
    if (triggerId != null) {
      pruneExpiredUserIngestTriggers();
      pendingUserIngestByTriggerId.set(Number(triggerId), {
        mintKey,
        expiresAt: expiresAt + 5_000
      });
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
 * Same contract-address → FaSol card flow as `requestFaSolEnrichment`, but posts to `TELEGRAM_CA_ANALYZER_CHAT_ID`
 * so production FaSol ingest traffic stays separate from the main operator group.
 * @param {string} contractAddress
 * @param {{ timeoutMs?: number }} [opts]
 */
async function requestCaAnalyzerFaSolEnrichment(contractAddress, opts = {}) {
  const rawCa = String(contractAddress || '').trim();
  const core = normalizeMintCore(rawCa);
  if (!isLikelySolanaMint(core)) {
    throw new Error('Invalid Solana contract address');
  }

  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const chatIdRaw = getCaAnalyzerChatIdRaw();
  const chatNorm = normalizeTelegramSupergroupChatIdForBotApi(chatIdRaw);
  const chatId = chatNorm?.chatId;
  if (!token) {
    throw new Error(
      'CA Analyzer: TELEGRAM_BOT_TOKEN is empty on the apiServer/bot host. ' +
        'The dashboard only calls your bridge; Telegram uses the token from this process’s environment.'
    );
  }
  if (chatId == null || !Number.isFinite(chatId)) {
    const detail = chatIdRaw
      ? `TELEGRAM_CA_ANALYZER_CHAT_ID is set but not parseable as digits (check for quotes/spaces/hidden chars). Raw length=${chatIdRaw.length}.`
      : 'TELEGRAM_CA_ANALYZER_CHAT_ID is empty.';
    throw new Error(
      `CA Analyzer: ${detail} Set a numeric supergroup/channel id on the same host as apiServer (usually -100…), then restart.`
    );
  }
  if (chatNorm?.normalizedFromPositive) {
    console.log(
      `[CA-Analyzer/FaSol] TELEGRAM_CA_ANALYZER_CHAT_ID normalized bare positive "${chatIdRaw}" → ${chatId}`
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

  const apiBase = `https://api.telegram.org/bot${encodeURIComponent(token)}`;
  const topicRaw = String(process.env.TELEGRAM_CA_ANALYZER_TOPIC_ID ?? '').trim();
  const topicId = topicRaw ? Number(topicRaw) : null;
  const body = {
    chat_id: chatId,
    text: rawCa,
    disable_web_page_preview: true
  };
  if (topicId != null && Number.isFinite(topicId) && topicId > 0) {
    body.message_thread_id = Math.floor(topicId);
  }

  try {
    console.log(
      `[CA-Analyzer/FaSol] Posting CA to analyzer chat ${chatId}` +
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
    let hint = '';
    if (/chat not found/i.test(String(desc))) {
      hint =
        ' — Checklist: the bot for TELEGRAM_BOT_TOKEN on this apiServer host must be a member of that chat; ' +
        'confirm chat_id from inside that chat (supergroups/channels use -100…); restart apiServer after .env changes; ' +
        'forums may need TELEGRAM_CA_ANALYZER_TOPIC_ID.';
    } else if (/thread/i.test(String(desc)) || /topic/i.test(String(desc))) {
      hint = ' — set TELEGRAM_CA_ANALYZER_TOPIC_ID to the forum topic id where FaSol listens.';
    }
    console.error('[CA-Analyzer/FaSol] sendMessage failed:', desc, tg?.error_code ?? '', hint);
    throw new Error(`sendMessage failed: ${desc}${hint}`);
  }

  return p;
}

/**
 * Post a CA into the **outside** FaSol group (see TELEGRAM_FASOL_OUTSIDE_CHAT_ID), wait for FaSol’s reply
 * (must reply to McGBot’s trigger message), then insert `public.outside_calls` via service role.
 * Call this from your X / outside-source worker when an allow-listed handle posts a mint.
 *
 * @param {string} contractAddress
 * @param {{ sourceId: string; tweetId?: string | null; xPostUrl?: string | null; timeoutMs?: number; mintResolution?: 'ca_in_post'|'curated_map'|'dex_search'; signalTicker?: string | null }} opts
 */
async function requestFaSolEnrichmentOutside(contractAddress, opts = {}) {
  const rawCa = String(contractAddress || '').trim();
  const core = normalizeMintCore(rawCa);
  if (!isLikelySolanaMint(core)) {
    throw new Error('Invalid Solana contract address');
  }

  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const chatIdRaw = getFaSolOutsideIngestChatIdRaw();
  const chatId = Number(chatIdRaw);
  if (!token || !Number.isFinite(chatId)) {
    throw new Error(
      'Outside Telegram ingest not configured (need TELEGRAM_BOT_TOKEN and TELEGRAM_FASOL_OUTSIDE_CHAT_ID)'
    );
  }

  const sourceId = String(opts.sourceId || '').trim();
  if (!sourceId) {
    throw new Error('requestFaSolEnrichmentOutside: sourceId (outside_x_sources.id uuid) is required');
  }

  const timeoutDefault = Number(process.env.TELEGRAM_FASOL_ENRICH_TIMEOUT_MS || 28_000);
  const timeoutMs = Math.max(2_000, Math.min(60_000, Number(opts.timeoutMs || timeoutDefault)));

  const apiBase = `https://api.telegram.org/bot${encodeURIComponent(token)}`;
  const topicRaw = String(process.env.TELEGRAM_FASOL_OUTSIDE_INGEST_TOPIC_ID ?? '').trim();
  const topicId = topicRaw ? Number(topicRaw) : null;
  const body = {
    chat_id: chatId,
    text: rawCa,
    disable_web_page_preview: true
  };
  if (topicId != null && Number.isFinite(topicId) && topicId > 0) {
    body.message_thread_id = Math.floor(topicId);
  }

  let triggerId;
  try {
    console.log(
      `[OutsideCall/FaSol] Posting CA to outside ingest chat ${chatId}` +
        `${body.message_thread_id ? ` topic ${body.message_thread_id}` : ''} …`
    );
    const sm = await axios.post(`${apiBase}/sendMessage`, body, { timeout: 15000 });
    if (sm?.data?.ok !== true) {
      throw new Error(sm?.data?.description || 'sendMessage ok=false');
    }
    triggerId = sm?.data?.result?.message_id;
    if (triggerId == null) {
      throw new Error('sendMessage missing message_id');
    }
  } catch (e) {
    const tg = e?.response?.data;
    const desc =
      (tg && typeof tg === 'object' ? tg.description : null) || e?.message || String(e);
    const hint =
      /thread/i.test(String(desc)) || /topic/i.test(String(desc))
        ? ' — set TELEGRAM_FASOL_OUTSIDE_INGEST_TOPIC_ID to the forum topic id where FaSol listens.'
        : '';
    console.error('[OutsideCall/FaSol] sendMessage failed:', desc, tg?.error_code ?? '', hint);
    throw new Error(`sendMessage failed: ${desc}${hint}`);
  }

  const tweetId =
    opts.tweetId != null && String(opts.tweetId).trim() ? String(opts.tweetId).trim() : null;
  const xPostUrl =
    opts.xPostUrl != null && String(opts.xPostUrl).trim() ? String(opts.xPostUrl).trim() : null;

  const mintResolutionRaw = String(opts.mintResolution || 'ca_in_post').trim().toLowerCase();
  const mintResolution =
    mintResolutionRaw === 'curated_map' || mintResolutionRaw === 'dex_search'
      ? mintResolutionRaw
      : 'ca_in_post';
  const signalTicker =
    opts.signalTicker != null && String(opts.signalTicker).trim()
      ? String(opts.signalTicker).trim().toUpperCase()
      : null;

  return new Promise((resolve, reject) => {
    const row = {
      sourceId,
      mint: core,
      tweetId,
      xPostUrl,
      mintResolution,
      signalTicker,
      resolve,
      reject,
      timer: null
    };
    row.timer = setTimeout(() => {
      if (pendingOutsideByTriggerId.get(triggerId) === row) {
        pendingOutsideByTriggerId.delete(triggerId);
        reject(new Error('timeout'));
      }
    }, timeoutMs + 250);
    pendingOutsideByTriggerId.set(triggerId, row);
  });
}

async function handleOutsideFaSolReply(message) {
  const outsideRaw = getFaSolOutsideIngestChatIdRaw();
  const outsideChatId = Number(outsideRaw);
  if (!Number.isFinite(outsideChatId) || Number(message?.chat?.id) !== outsideChatId) {
    return;
  }

  const replyToId = message.reply_to_message?.message_id;
  if (replyToId == null) {
    return;
  }

  const pending = pendingOutsideByTriggerId.get(replyToId);
  if (!pending) {
    return;
  }

  // IMPORTANT: We key off `reply_to_message.message_id` first.
  // This prevents silent drops when FaSol’s username changes; any reply we can
  // match to a pending trigger is (by construction) related to our ingest flow.
  const uname = senderUsernameFromMessage(message);
  const senderChatId =
    message?.sender_chat?.id != null ? Number(message.sender_chat.id) : null;
  const isChannelPostFromIngest =
    senderChatId != null && Number.isFinite(senderChatId) && senderChatId === outsideChatId;
  const faSolUsers = faSolAllowedUsernames();
  if (!isChannelPostFromIngest) {
    if (!uname || !faSolUsers.has(uname)) {
      console.warn(
        `[OutsideCall/FaSol] FaSol sender mismatch (still accepting pending reply). replyToId=${replyToId} uname=${uname || '(empty)'} source=${pending.sourceId} mint=${pending.mint.slice(0, 8)}…`
      );
    }
  }

  let parsedMaybe;
  try {
    parsedMaybe = parseFaSolPost(message);
  } catch (_) {
    return;
  }

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
  if (!enrichable) {
    return;
  }

  const ins = await insertOutsideCallRow({
    sourceId: pending.sourceId,
    mint: pending.mint,
    tweetId: pending.tweetId,
    xPostUrl: pending.xPostUrl,
    mint_resolution: pending.mintResolution,
    signal_ticker: pending.signalTicker
  });

  if (pending.timer) {
    clearTimeout(pending.timer);
  }
  pendingOutsideByTriggerId.delete(replyToId);

  if (ins.ok || ins.error === 'duplicate_tweet_or_conflict') {
    if (!ins.ok) {
      console.log(
        `[OutsideCall/FaSol] Duplicate tweet or conflict for mint ${pending.mint.slice(0, 8)}… — treating as done`
      );
    } else {
      console.log(
        `[OutsideCall/FaSol] Inserted ${ins.callRole} row for source ${pending.sourceId} mint ${pending.mint.slice(0, 8)}…`
      );
    }
    pending.resolve({ mint: pending.mint, parsed: parsedMaybe, message, insert: ins });
  } else {
    console.error('[OutsideCall/FaSol] outside_calls insert failed:', ins);
    pending.reject(new Error(ins.error || 'outside_call_insert_failed'));
  }
}

/**
 * @param {{ discordBotCallsChannel: import('discord.js').TextChannel | null }} opts
 */
function startTelegramFaSolMirror(opts) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const mirrorEnabled = truthyEnv(process.env.TELEGRAM_FASOL_MIRROR);
  const enrichListener = truthyEnv(process.env.TELEGRAM_FASOL_ENRICH_USER_CALLS);
  const userChatIdRaw = getFaSolIngestChatIdRaw();
  const outsideChatIdRaw = getFaSolOutsideIngestChatIdRaw();
  const caAnalyzerChatIdRaw = getCaAnalyzerChatIdRaw();
  const outsideIngestConfigured = Boolean(outsideChatIdRaw);
  const caAnalyzerConfigured = Boolean(caAnalyzerChatIdRaw);
  const enabled = mirrorEnabled || enrichListener || outsideIngestConfigured || caAnalyzerConfigured;
  const faSolUsers = faSolAllowedUsernames();

  const tgBotCalls = botCallsTelegramTarget();

  if (!enabled) {
    console.log(
      '[TelegramFaSol] Ingest idle — enable TELEGRAM_FASOL_MIRROR, TELEGRAM_FASOL_ENRICH_USER_CALLS, outside ingest, and/or set TELEGRAM_CA_ANALYZER_CHAT_ID.'
    );
    return;
  }
  if (!token) {
    console.warn('[TelegramFaSol] TELEGRAM_BOT_TOKEN is empty — ingest listener not started.');
    return;
  }
  if (!userChatIdRaw && !outsideChatIdRaw && !caAnalyzerChatIdRaw) {
    console.warn(
      '[TelegramFaSol] TELEGRAM_FASOL_CHAT_ID (or INGEST), TELEGRAM_FASOL_OUTSIDE_CHAT_ID, and TELEGRAM_CA_ANALYZER_CHAT_ID are all empty — ingest listener not started.'
    );
    return;
  }

  const userIngestChatId = userChatIdRaw ? Number(userChatIdRaw) : NaN;
  const outsideIngestChatId = outsideChatIdRaw ? Number(outsideChatIdRaw) : NaN;
  const caNorm = caAnalyzerChatIdRaw ? normalizeTelegramSupergroupChatIdForBotApi(caAnalyzerChatIdRaw) : null;
  const caAnalyzerChatId = caNorm ? caNorm.chatId : NaN;
  if (userChatIdRaw && !Number.isFinite(userIngestChatId)) {
    console.warn('[TelegramFaSol] TELEGRAM_FASOL_CHAT_ID must be a numeric id (got non-number).');
    return;
  }
  if (outsideChatIdRaw && !Number.isFinite(outsideIngestChatId)) {
    console.warn('[TelegramFaSol] TELEGRAM_FASOL_OUTSIDE_CHAT_ID must be a numeric id (got non-number).');
    return;
  }
  if (caAnalyzerChatIdRaw && !Number.isFinite(caAnalyzerChatId)) {
    console.warn('[TelegramFaSol] TELEGRAM_CA_ANALYZER_CHAT_ID must be a numeric id (got non-number).');
    return;
  }
  if (
    Number.isFinite(userIngestChatId) &&
    Number.isFinite(outsideIngestChatId) &&
    userIngestChatId === outsideIngestChatId
  ) {
    console.warn(
      '[TelegramFaSol] TELEGRAM_FASOL_CHAT_ID and TELEGRAM_FASOL_OUTSIDE_CHAT_ID are the same — outside + user ingest routing will misbehave.'
    );
  }
  if (Number.isFinite(caAnalyzerChatId)) {
    if (Number.isFinite(userIngestChatId) && caAnalyzerChatId === userIngestChatId) {
      console.warn('[TelegramFaSol] CA Analyzer chat id equals TELEGRAM_FASOL_CHAT_ID — routing may overlap.');
    }
    if (Number.isFinite(outsideIngestChatId) && caAnalyzerChatId === outsideIngestChatId) {
      console.warn('[TelegramFaSol] CA Analyzer chat id equals TELEGRAM_FASOL_OUTSIDE_CHAT_ID — routing may overlap.');
    }
  }

  const channel = opts?.discordBotCallsChannel;
  if (mirrorEnabled && (!channel || typeof channel.send !== 'function')) {
    console.warn(
      '[TelegramFaSol] Mirror enabled but no Discord #bot-calls channel — FaSol→Discord mirror disabled. ' +
        'Ingest listener still runs so !call / dashboard enrichment can receive FaSol replies.'
    );
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
  if (caAnalyzerConfigured) modeBits.push('ca-analyzer');
  const ingestChatLabel =
    [userChatIdRaw, outsideChatIdRaw, caAnalyzerChatIdRaw].filter(Boolean).join(' | ') || 'n/a';
  console.log(
    `[TelegramFaSol] Ingest ON (${modeBits.join(' + ')}) — TG chat(s) ${ingestChatLabel}, FaSol usernames: ${[...faSolUsers].join(', ')}` +
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
    const mid = Number(message.chat.id);
    if (Number.isFinite(outsideIngestChatId) && mid === outsideIngestChatId) {
      await handleOutsideFaSolReply(message);
      return;
    }
    if (Number.isFinite(caAnalyzerChatId) && mid === caAnalyzerChatId) {
      const unameCa = senderUsernameFromMessage(message);
      const senderChatIdCa =
        message?.sender_chat?.id != null ? Number(message.sender_chat.id) : null;
      const isChannelPostCa =
        senderChatIdCa != null && Number.isFinite(senderChatIdCa) && senderChatIdCa === caAnalyzerChatId;
      if (!isChannelPostCa) {
        if (!unameCa || !faSolUsers.has(unameCa)) return;
      }
      const mintsCa = extractMintsFromTelegramMessage(message);
      for (const mint of mintsCa) {
        if (!isLikelySolanaMint(mint)) continue;
        try {
          const parsedMaybe = parseFaSolPost(message);
          const enrichableCa =
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
          if (enrichableCa) {
            const keyCa = canonicalMintKey(mint);
            const pendingCa = pendingEnrichment.get(keyCa);
            if (pendingCa && pendingCa.length) {
              pendingEnrichment.delete(keyCa);
              for (const waiter of pendingCa) {
                if (waiter.expiresAt > Date.now()) {
                  waiter.resolve({ mint, parsed: parsedMaybe, message });
                }
              }
            }
          }
        } catch (_) {
          /* ignore */
        }
      }
      return;
    }

    if (!Number.isFinite(userIngestChatId) || mid !== userIngestChatId) return;

    const uname = senderUsernameFromMessage(message);
    const senderChatId =
      message?.sender_chat?.id != null ? Number(message.sender_chat.id) : null;
    const isChannelPostFromIngest =
      senderChatId != null && Number.isFinite(senderChatId) && senderChatId === userIngestChatId;

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

      const replyToId = message.reply_to_message?.message_id;
      if (replyToId != null) {
        pruneExpiredUserIngestTriggers();
        if (pendingUserIngestByTriggerId.has(Number(replyToId))) {
          skipMirrorForUserEnrich = true;
        }
      }

      const existingTracked = getTrackedCall(mint);
      if (
        existingTracked &&
        existingTracked.isActive !== false &&
        String(existingTracked.callSourceType || '').trim() === 'user_call'
      ) {
        skipMirrorForUserEnrich = true;
      }

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
          `[TelegramFaSol] Skip bot-call mirror for ${mint.slice(0, 6)}… — user-call ingest (FaSol enrich / reply / active member call)`
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
      const scan = await buildScanForDiscordMirror(mint, parsed);

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

module.exports = {
  startTelegramFaSolMirror,
  requestFaSolEnrichment,
  requestFaSolEnrichmentOutside,
  requestCaAnalyzerFaSolEnrichment
};
