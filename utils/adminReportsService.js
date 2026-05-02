'use strict';

const { EmbedBuilder } = require('discord.js');
const { readJson } = require('./jsonStore');
const { MOD_ACTIONS_PATH } = require('./modActionsService');
const { getAllTrackedCalls } = require('./trackedCallsService');

const MS_DAY = 24 * 60 * 60 * 1000;
const MS_WEEK = 7 * MS_DAY;
const MAX_VALID_X = 500;
const NOTE_BUCKET_MAX = 6;
const PER_MOD_RATIO_LINES = 10;

const TYPE_ORDER = [
  'coin',
  'premium',
  'x_verify',
  'dev',
  'coin_deny',
  'coin_exclude',
  'x_verify_deny'
];

function emptyTotalsByType() {
  return Object.fromEntries(TYPE_ORDER.map(t => [t, 0]));
}

const EMBED_FIELD_MAX = 1024;

function truncateEmbedField(text, maxLen = EMBED_FIELD_MAX) {
  const s = String(text || '');
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 24)}\n*…truncated*`;
}

function getAth(call) {
  return Number(
    call.athMc ||
      call.ath ||
      call.athMarketCap ||
      call.latestMarketCap ||
      call.firstCalledMarketCap ||
      0
  );
}

function calculateX(firstMc, athMc) {
  if (!firstMc || !athMc || firstMc <= 0) return NaN;
  return athMc / firstMc;
}

function isValidPerformanceCall(call) {
  const x = calculateX(call.firstCalledMarketCap, getAth(call));
  return Number.isFinite(x) && x > 0 && x <= MAX_VALID_X;
}

function formatPct(part, whole) {
  if (!whole || whole <= 0) return '—';
  return `${Math.round((100 * part) / whole)}%`;
}

function formatAvgX(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${n.toFixed(2)}x`;
}

/**
 * @returns {{
 *   totalAutoCalls: number,
 *   totalUserCalls: number,
 *   totalWatchOnly: number,
 *   totalApprovals: number,
 *   totalRejections: number
 * }}
 */
function computeSystemStats() {
  const calls = getAllTrackedCalls();
  let totalAutoCalls = 0;
  let totalUserCalls = 0;
  let totalWatchOnly = 0;
  let totalApprovals = 0;
  let totalRejections = 0;

  for (const c of calls) {
    const src = String(c.callSourceType || '').toLowerCase();
    if (src === 'bot_call') totalAutoCalls += 1;
    else if (src === 'user_call') totalUserCalls += 1;
    else if (src === 'watch_only') totalWatchOnly += 1;

    const st = String(c.approvalStatus || '').toLowerCase();
    if (st === 'approved') totalApprovals += 1;
    else if (st === 'denied' || st === 'excluded') totalRejections += 1;
  }

  return {
    totalAutoCalls,
    totalUserCalls,
    totalWatchOnly,
    totalApprovals,
    totalRejections
  };
}

/**
 * @returns {{
 *   avgXBot: number | null,
 *   avgXUser: number | null,
 *   botReach2xPct: string,
 *   botReach5xPct: string,
 *   botValidForAvg: number,
 *   botTotalForMilestone: number
 * } | null}
 */
function computePerformanceStats() {
  const calls = getAllTrackedCalls();
  let sumBot = 0;
  let nBotValid = 0;
  let sumUser = 0;
  let nUserValid = 0;
  let nBotMilestone = 0;
  let nBot2x = 0;
  let nBot5x = 0;

  for (const c of calls) {
    if (c.hiddenFromDashboard === true) continue;
    const src = String(c.callSourceType || '').toLowerCase();

    if (src === 'bot_call') {
      if (isValidPerformanceCall(c)) {
        const x = calculateX(c.firstCalledMarketCap, getAth(c));
        sumBot += x;
        nBotValid += 1;
      }
      const firstMc = Number(c.firstCalledMarketCap || 0);
      const ath = getAth(c);
      const x = calculateX(firstMc, ath);
      if (firstMc > 0 && ath > 0 && Number.isFinite(x)) {
        nBotMilestone += 1;
        if (x >= 2) nBot2x += 1;
        if (x >= 5) nBot5x += 1;
      }
    } else if (src === 'user_call') {
      if (isValidPerformanceCall(c)) {
        const x = calculateX(c.firstCalledMarketCap, getAth(c));
        sumUser += x;
        nUserValid += 1;
      }
    }
  }

  return {
    avgXBot: nBotValid ? sumBot / nBotValid : null,
    avgXUser: nUserValid ? sumUser / nUserValid : null,
    botReach2xPct: formatPct(nBot2x, nBotMilestone),
    botReach5xPct: formatPct(nBot5x, nBotMilestone),
    botValidForAvg: nBotValid,
    botTotalForMilestone: nBotMilestone
  };
}

/**
 * @returns {{ denied: number, excluded: number, noteSummary: string }}
 */
function computeRejectionBreakdown() {
  const calls = getAllTrackedCalls();
  let denied = 0;
  let excluded = 0;
  /** @type {Map<string, number>} */
  const noteCounts = new Map();

  for (const c of calls) {
    const st = String(c.approvalStatus || '').toLowerCase();
    if (st !== 'denied' && st !== 'excluded') continue;
    if (st === 'denied') denied += 1;
    else excluded += 1;

    const raw = String(c.moderationNotes || '').trim();
    const key = raw ? raw.slice(0, 72).replace(/\s+/g, ' ') : '(no mod notes)';
    noteCounts.set(key, (noteCounts.get(key) || 0) + 1);
  }

  const top = [...noteCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, NOTE_BUCKET_MAX);

  let noteSummary = '—';
  if (denied + excluded > 0 && top.length) {
    noteSummary = top.map(([k, v]) => `• ${v}× \`${k}\``).join('\n');
  } else if (denied + excluded > 0) {
    noteSummary = '*(no note text stored)*';
  }

  return { denied, excluded, noteSummary };
}

/**
 * @returns {Promise<Array<{ moderatorId: string, actionType: string, timestamp: string, dedupeKey?: string }>>}
 */
async function loadModActions() {
  try {
    const data = await readJson(MOD_ACTIONS_PATH);
    return Array.isArray(data?.actions) ? data.actions : [];
  } catch (e) {
    const code = e && /** @type {{ code?: string }} */ (e).code;
    if (code === 'ENOENT') return [];
    console.error('[AdminReports] Could not read modActions.json:', e.message || e);
    return [];
  }
}

/**
 * @param {Array<{ moderatorId?: string, actionType?: string, timestamp?: string }>} actions
 * @param {number} sinceMs
 */
function filterActionsSince(actions, sinceMs) {
  return actions.filter(a => {
    const t = Date.parse(String(a.timestamp || ''));
    return Number.isFinite(t) && t >= sinceMs;
  });
}

/**
 * @param {Array<{ moderatorId?: string, actionType?: string }>} actions
 */
function aggregateModeration(actions) {
  /** @type {Map<string, { total: number, byType: Record<string, number> }>} */
  const byMod = new Map();
  const totalsByType = emptyTotalsByType();

  for (const a of actions) {
    const modId = String(a.moderatorId || '').trim();
    const type = String(a.actionType || '');
    if (!modId || !Object.prototype.hasOwnProperty.call(totalsByType, type)) continue;

    totalsByType[type] += 1;

    if (!byMod.has(modId)) {
      byMod.set(modId, {
        total: 0,
        byType: emptyTotalsByType()
      });
    }
    const row = byMod.get(modId);
    row.total += 1;
    row.byType[type] += 1;
  }

  return { byMod, totalsByType };
}

/**
 * @param {Record<string, number>} totalsByType
 */
function summarizeModerationCounts(totalsByType) {
  return {
    coinApprovals: (totalsByType.coin || 0) + (totalsByType.premium || 0),
    coinDenies: totalsByType.coin_deny || 0,
    coinExcludes: totalsByType.coin_exclude || 0,
    xApprovals: totalsByType.x_verify || 0,
    xDenies: totalsByType.x_verify_deny || 0,
    devAdds: totalsByType.dev || 0
  };
}

/**
 * @param {Map<string, { byType: Record<string, number> }>} byMod
 */
function formatPerModApprovalDenialRatios(byMod) {
  const rows = [];

  for (const [id, row] of byMod) {
    const appr =
      (row.byType.coin || 0) +
      (row.byType.premium || 0) +
      (row.byType.x_verify || 0);
    const den =
      (row.byType.coin_deny || 0) +
      (row.byType.coin_exclude || 0) +
      (row.byType.x_verify_deny || 0);
    if (appr + den === 0) continue;
    rows.push({ id, appr, den });
  }

  rows.sort((a, b) => b.appr + b.den - (a.appr + a.den));

  const lines = [];
  for (let i = 0; i < Math.min(rows.length, PER_MOD_RATIO_LINES); i++) {
    const { id, appr, den } = rows[i];
    if (den === 0) {
      lines.push(`<@${id}> — **${appr}** appr · **0** den`);
    } else {
      const ratio = appr / den;
      const rLabel = ratio >= 10 ? ratio.toFixed(1) : ratio.toFixed(2);
      lines.push(`<@${id}> — **${appr}** appr / **${den}** den → **${rLabel}:1**`);
    }
  }

  if (rows.length > PER_MOD_RATIO_LINES) {
    lines.push(`*…+${rows.length - PER_MOD_RATIO_LINES} mod(s)*`);
  }

  return lines.length ? lines.join('\n') : '— *No appr/den activity in window*';
}

/**
 * @param {'daily' | 'weekly'} kind
 */
function buildAdminReportEmbed(kind, system, performance, rejection, modWindow, windowLabel) {
  const title =
    kind === 'daily' ? '📊 Daily admin report' : '📊 Weekly admin report';

  const systemLines = [
    `**Auto-calls:** ${system.totalAutoCalls} · **User:** ${system.totalUserCalls}${
      system.totalWatchOnly > 0 ? ` · **Watch-only:** ${system.totalWatchOnly}` : ''
    }`,
    `**Coin approvals** (tracked): ${system.totalApprovals} · **Rejections:** ${system.totalRejections}`
  ].join('\n');

  const rejLines = [
    `**Denied:** ${rejection.denied} · **Excluded:** ${rejection.excluded}`,
    rejection.denied + rejection.excluded > 0
      ? `**By mod notes** (top ${NOTE_BUCKET_MAX}):\n${rejection.noteSummary}`
      : ''
  ]
    .filter(Boolean)
    .join('\n');

  const perfLines = performance
    ? [
        `**Avg X (bot):** ${formatAvgX(performance.avgXBot)} _(${performance.botValidForAvg} calls ≤${MAX_VALID_X}x)_`,
        `**Avg X (user):** ${formatAvgX(performance.avgXUser)}`,
        `**Bot ≥2x:** ${performance.botReach2xPct} _(${performance.botTotalForMilestone} w/ MC data)_`,
        `**Bot ≥5x:** ${performance.botReach5xPct}`
      ].join('\n')
    : '— *performance unavailable*';

  const counts = modWindow.counts;
  const modHeader =
    kind === 'daily'
      ? `**Window:** last 24h (\`${windowLabel}\`)`
      : `**Window:** last 7d (\`${windowLabel}\`)`;

  const modLines = [
    modHeader,
    '',
    `**Coin appr:** ${counts.coinApprovals} · **deny:** ${counts.coinDenies} · **exclude:** ${counts.coinExcludes}`,
    `**X appr:** ${counts.xApprovals} · **X deny:** ${counts.xDenies} · **Dev add:** ${counts.devAdds}`,
    '',
    '**Appr : den per mod** (coin+X)',
    truncateEmbedField(modWindow.perModRatios)
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .addFields(
      {
        name: 'System (all-time)',
        value: truncateEmbedField([systemLines, '', rejLines].join('\n')),
        inline: false
      },
      { name: 'Performance (all-time)', value: truncateEmbedField(perfLines), inline: false },
      { name: 'Moderation (window)', value: truncateEmbedField(modLines), inline: false }
    )
    .setFooter({ text: `McG Scanner • ${kind} report` })
    .setTimestamp(new Date());

  return embed;
}

/**
 * @param {import('discord.js').Client} client
 * @param {string} ownerId
 * @param {'daily' | 'weekly'} kind
 */
async function sendAdminReport(client, ownerId, kind) {
  const owner = String(ownerId || '').trim();
  if (!owner) return;

  try {
    const now = Date.now();
    const sinceMs = kind === 'daily' ? now - MS_DAY : now - MS_WEEK;
    const windowLabel = `${new Date(sinceMs).toISOString().slice(0, 16)}Z → now`;

    let system = {
      totalAutoCalls: 0,
      totalUserCalls: 0,
      totalWatchOnly: 0,
      totalApprovals: 0,
      totalRejections: 0
    };
    try {
      system = computeSystemStats();
    } catch (e) {
      console.error('[AdminReports] System stats failed:', e.message || e);
    }

    let performance = null;
    try {
      performance = computePerformanceStats();
    } catch (e) {
      console.error('[AdminReports] Performance stats failed:', e.message || e);
    }

    let rejection = { denied: 0, excluded: 0, noteSummary: '—' };
    try {
      rejection = computeRejectionBreakdown();
    } catch (e) {
      console.error('[AdminReports] Rejection breakdown failed:', e.message || e);
    }

    let modWindow = {
      counts: summarizeModerationCounts(emptyTotalsByType()),
      perModRatios: '—'
    };
    try {
      const allModActions = await loadModActions();
      const windowActions = filterActionsSince(allModActions, sinceMs);
      const modAgg = aggregateModeration(windowActions);
      modWindow = {
        counts: summarizeModerationCounts(modAgg.totalsByType),
        perModRatios: formatPerModApprovalDenialRatios(modAgg.byMod)
      };
    } catch (e) {
      console.error('[AdminReports] Moderation window failed:', e.message || e);
    }

    const embed = buildAdminReportEmbed(
      kind,
      system,
      performance,
      rejection,
      modWindow,
      windowLabel
    );

    try {
      const user = await client.users.fetch(owner);
      await user.send({ embeds: [embed] });
    } catch (e) {
      console.error('[AdminReports] DM to owner failed:', e.message || e);
    }
  } catch (e) {
    console.error('[AdminReports] Report failed:', e.message || e);
  }
}

/**
 * @param {import('discord.js').Client} client
 */
function startAdminReports(client) {
  const ownerId = String(process.env.BOT_OWNER_ID ?? '').trim();
  if (!ownerId) {
    console.log('[AdminReports] BOT_OWNER_ID not set; scheduled reports disabled');
    return;
  }

  const scheduleEvery = (kind, ms) => {
    const tick = () => {
      Promise.resolve(sendAdminReport(client, ownerId, kind)).finally(() => {
        setTimeout(tick, ms);
      });
    };
    setTimeout(tick, ms);
  };

  scheduleEvery('daily', MS_DAY);
  scheduleEvery('weekly', MS_WEEK);

  console.log('[AdminReports] Scheduled daily (24h) and weekly (7d) DMs to bot owner');
}

module.exports = {
  startAdminReports,
  sendAdminReport,
  computeSystemStats
};
