'use strict';

/**
 * Admin owner DMs: 3 embeds (operations · revenue & X · performance).
 *
 * Schedule: calendar-based in `ADMIN_REPORT_TIMEZONE` at `ADMIN_REPORT_LOCAL_HOUR` (0–23),
 * within the first ~12 minutes of that hour: daily every day, weekly on Mondays,
 * monthly on the 1st. State: `data/adminReportScheduleState.json`.
 *
 * Env: `BOT_OWNER_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (billing + membership_events),
 * `ADMIN_REPORT_TIMEZONE` (default America/Chicago), `ADMIN_REPORT_LOCAL_HOUR` (default 9).
 */

const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { readJson, writeJson } = require('./jsonStore');
const { MOD_ACTIONS_PATH } = require('./modActionsService');
const { getAllTrackedCalls } = require('./trackedCallsService');
const { fetchAdminBillingSnapshot } = require('./adminBillingStats');
const {
  loadXPostAuditEventsSince,
  summarizeXPostAudit
} = require('./xPostAudit');
const {
  resolveAdminTimeZone,
  resolveLocalReportHour,
  resolveReportWindow,
  zonedWallParts
} = require('./adminReportTime');

const SCHEDULE_STATE_PATH = path.join(__dirname, '../data/adminReportScheduleState.json');

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

/** @param {unknown} call */
function callFirstMs(call) {
  const t = Date.parse(String(call.firstCalledAt || call.calledAt || call.createdAt || ''));
  return Number.isFinite(t) ? t : 0;
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
 * @param {unknown[]} calls
 */
function computePerformanceStatsForCalls(calls) {
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

function computePerformanceStats() {
  return computePerformanceStatsForCalls(getAllTrackedCalls());
}

/**
 * @param {number} sinceMs
 * @param {number} untilMs
 */
function computePerformanceStatsWindow(sinceMs, untilMs) {
  const calls = getAllTrackedCalls().filter(c => {
    const t = callFirstMs(c);
    return t > 0 && t >= sinceMs && t <= untilMs;
  });
  return computePerformanceStatsForCalls(calls);
}

/**
 * @param {number} sinceMs
 * @param {number} untilMs
 */
function computeCallVolumeWindow(sinceMs, untilMs) {
  let bot = 0;
  let user = 0;
  let watch = 0;
  for (const c of getAllTrackedCalls()) {
    const t = callFirstMs(c);
    if (!t || t < sinceMs || t > untilMs) continue;
    const src = String(c.callSourceType || '').toLowerCase();
    if (src === 'bot_call') bot += 1;
    else if (src === 'watch_only') watch += 1;
    else user += 1;
  }
  return { bot, user, watch, total: bot + user + watch };
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

/** @param {Record<string, { ok: number, fail: number }>} byCat */
function rollupHasActivity(byCat, keys) {
  for (const k of keys) {
    const row = byCat[k];
    if (row && (row.ok > 0 || row.fail > 0)) return true;
  }
  return false;
}

/** @param {'daily' | 'weekly' | 'monthly'} kind */
function perfWindowColumnHeader(kind) {
  if (kind === 'daily') return 'Rolling 24h';
  if (kind === 'weekly') return 'Rolling 7d';
  return 'Month roll';
}

function mdCodeBlock(inner) {
  const body = String(inner || '').trimEnd();
  return `\`\`\`\n${body}\n\`\`\``;
}

/**
 * Aligned monospace table: performance window vs all-time (parentheses = MC-backed counts).
 */
function formatPerfMarkdownTable(kind, w, a) {
  const cw = perfWindowColumnHeader(kind);
  const pad = (s, n) => String(s).slice(0, n).padEnd(n);
  const W = 18;
  const A = 17;
  const B = 17;
  const row = (label, left, right) => `${pad(label, W)} ${pad(left, A)} ${pad(right, B)}`;
  const lines = [
    row('Metric', cw, 'All-time'),
    `${pad('─'.repeat(16), W)} ${pad('─'.repeat(15), A)} ${pad('─'.repeat(15), B)}`,
    row(
      'Avg × bot',
      `${formatAvgX(w.avgXBot)} (${w.botValidForAvg})`,
      `${formatAvgX(a.avgXBot)} (${a.botValidForAvg})`
    ),
    row('Avg × user', formatAvgX(w.avgXUser), formatAvgX(a.avgXUser)),
    row(
      'Bot ≥2×',
      `${w.botReach2xPct} (${w.botTotalForMilestone})`,
      `${a.botReach2xPct} (${a.botTotalForMilestone})`
    ),
    row('Bot ≥5×', w.botReach5xPct, a.botReach5xPct)
  ];
  return mdCodeBlock(lines.join('\n'));
}

/** All-time pipeline + rejection counts (monospace). */
function formatPipelineMarkdown(system, rejection) {
  const lines = [
    `Auto calls           ${system.totalAutoCalls}`,
    `User calls           ${system.totalUserCalls}`,
    ...(system.totalWatchOnly > 0 ? [`Watch-only           ${system.totalWatchOnly}`] : []),
    `Coin approvals       ${system.totalApprovals}`,
    `Rejections           ${system.totalRejections}`,
    `Denied / excluded    ${rejection.denied} / ${rejection.excluded}`
  ];
  return mdCodeBlock(lines.join('\n'));
}

function formatModVolumeMarkdown(vol, counts) {
  return mdCodeBlock(
    [
      `New tracked (window)   ${vol.total}`,
      `  bot                  ${vol.bot}`,
      `  user                 ${vol.user}`,
      `  watch                ${vol.watch}`,
      '',
      `Coin  appr ${counts.coinApprovals}    deny ${counts.coinDenies}    excl ${counts.coinExcludes}`,
      `X     appr ${counts.xApprovals}    deny ${counts.xDenies}`,
      `Dev adds               ${counts.devAdds}`
    ].join('\n')
  );
}

/**
 * @param {ReturnType<summarizeXPostAudit>} xs
 * @param {string[]} opsKeys
 * @param {string[]} engagementKeys
 * @param {string[]} manualKeys
 */
function buildXAuditFieldValue(xs, ctx, opsKeys, engagementKeys, manualKeys) {
  const head = [
    `Audit rows **${ctx.xEventsLen}**`,
    `Posted **${xs.totalOk}** · failed **${xs.totalFail}** · media **${xs.mediaOk}** · replies **${xs.repliesOk}**`
  ].join('\n');

  const parts = [head];
  const milestoneLines = [];
  if (xs.milestoneUserSideOk || xs.milestoneUserSideFail) {
    milestoneLines.push(`Community (user+watch): **${xs.milestoneUserSideOk}** ok · **${xs.milestoneUserSideFail}** fail`);
  }
  if (xs.milestoneBotOk || xs.milestoneBotFail) {
    milestoneLines.push(`Bot: **${xs.milestoneBotOk}** ok · **${xs.milestoneBotFail}** fail`);
  }
  if (milestoneLines.length) {
    parts.push('', '**Milestones**', milestoneLines.join('\n'));
  }

  const digestKeys = [...opsKeys, ...engagementKeys];
  const rawKeys = Object.keys(xs.byCat).sort();
  const detailChunks = [];
  if (rollupHasActivity(xs.byCat, digestKeys)) {
    detailChunks.push(`**Digests & snapshots**\n${formatCategoryRollup(xs.byCat, digestKeys)}`);
  }
  if (rollupHasActivity(xs.byCat, manualKeys)) {
    detailChunks.push(`**Manual / tests**\n${formatCategoryRollup(xs.byCat, manualKeys)}`);
  }
  if (rollupHasActivity(xs.byCat, rawKeys)) {
    detailChunks.push(`**Categories (raw)**\n${formatCategoryRollup(xs.byCat, rawKeys)}`);
  }

  if (detailChunks.length) {
    parts.push('', ...detailChunks);
  } else if (ctx.xEventsLen === 0) {
    parts.push('', '_No X audit rows or category posts in this window._');
  }

  return truncateEmbedField(parts.join('\n'));
}

/** @param {Record<string, { ok: number, fail: number }>} byCat */
function formatCategoryRollup(byCat, keys) {
  const lines = [];
  for (const k of keys) {
    const row = byCat[k];
    if (!row || (row.ok === 0 && row.fail === 0)) continue;
    lines.push(`• **${k}** — ${row.ok} ok · ${row.fail} fail`);
  }
  return lines.length ? lines.join('\n') : '— *(no posted events in window)*';
}

/**
 * @param {'daily' | 'weekly' | 'monthly'} kind
 */
function kindTitle(kind) {
  if (kind === 'daily') return 'Daily';
  if (kind === 'weekly') return 'Weekly';
  return 'Monthly';
}

/**
 * @param {'daily' | 'weekly' | 'monthly'} kind
 */
function perfWindowLabel(kind) {
  if (kind === 'daily') return 'Rolling 24h (calls by first-called time)';
  if (kind === 'weekly') return 'Rolling 7d (calls by first-called time)';
  return 'Month-to-date (calls by first-called time)';
}

/**
 * @param {'daily' | 'weekly' | 'monthly'} kind
 * @param {{
 *   tz: string,
 *   windowLabel: string,
 *   system: ReturnType<computeSystemStats>,
 *   rejection: ReturnType<computeRejectionBreakdown>,
 *   modWindow: { counts: ReturnType<summarizeModerationCounts>, perModRatios: string },
 *   volWindow: ReturnType<computeCallVolumeWindow>,
 *   perfWindow: ReturnType<computePerformanceStatsForCalls>,
 *   perfAllTime: ReturnType<computePerformanceStatsForCalls>,
 *   billing: import('./adminBillingStats').AdminBillingSnapshot,
 *   xSummary: ReturnType<summarizeXPostAudit>,
 *   xEventsLen: number
 * }} ctx
 */
function buildAdminReportEmbeds(kind, ctx) {
  const kt = kindTitle(kind);
  const footerText = `McG Scanner · ${kt} · ${ctx.tz}`;
  const stamp = new Date();

  const attachFooter = e => e.setFooter({ text: footerText }).setTimestamp(stamp);

  const noteBlock =
    ctx.rejection.denied + ctx.rejection.excluded > 0
      ? `\n\n**By mod notes** _(top ${NOTE_BUCKET_MAX})_\n${ctx.rejection.noteSummary}`
      : '';

  const counts = ctx.modWindow.counts;

  const xs = ctx.xSummary;
  const opsKeys = ['approval_publish', 'leaderboard_digest', 'weekly_terminal_snapshot'];
  const engagementKeys = ['engagement_weekly_runner', 'engagement_monthly_top_caller'];
  const manualKeys = [
    'manual_connection_test',
    'manual_weekly_snapshot_test',
    'manual_test_milestone'
  ];

  const mrr = Number(ctx.billing.approxMrrUsd);
  const gross = Number(ctx.billing.windowGrossUsdFromCents);

  const billingLines = ctx.billing.ok
    ? mdCodeBlock(
        [
          `Active subscriptions    ${ctx.billing.activeSubscriptions}`,
          `Approx MRR (USD)        ${Number.isFinite(mrr) ? '$' + mrr.toFixed(2) : '—'}`,
          ctx.billing.planMixLines.length ? `Plan mix                ${ctx.billing.planMixLines.join(', ')}` : null,
          ctx.billing.pendingSolInvoices != null ? `Pending SOL quotes      ${ctx.billing.pendingSolInvoices}` : null,
          Object.keys(ctx.billing.paymentChannelMix || {}).length
            ? `Channels                ${Object.entries(ctx.billing.paymentChannelMix)
                .map(([k, v]) => `${k} ${v}`)
                .join(', ')}`
            : null,
          `Membership rows         ${ctx.billing.windowEventCount}`,
          `Recorded gross (USD)    $${Number.isFinite(gross) ? gross.toFixed(2) : '0.00'}`
        ]
          .filter(Boolean)
          .join('\n')
      )
    : `— **Billing unavailable:** ${ctx.billing.reason || 'unknown'}`;

  const perfCaption = `_${perfWindowLabel(kind)}_ vs **all-time** · parentheses = calls with MC for that metric`;

  const embedOps = new EmbedBuilder()
    .setColor(0x10b981)
    .setTitle(`McG Scanner · ${kt} · Operations`)
    .setDescription(`**Timezone:** ${ctx.tz}`)
    .addFields(
      {
        name: 'Reporting window',
        value: truncateEmbedField(ctx.windowLabel),
        inline: false
      },
      {
        name: 'Tracked pipeline (all-time)',
        value: truncateEmbedField(formatPipelineMarkdown(ctx.system, ctx.rejection) + noteBlock),
        inline: false
      },
      {
        name: 'Moderation & volume (same window)',
        value: truncateEmbedField(formatModVolumeMarkdown(ctx.volWindow, counts)),
        inline: false
      },
      {
        name: 'Appr ÷ den per mod (coin + X)',
        value: truncateEmbedField(ctx.modWindow.perModRatios),
        inline: false
      }
    );

  const embedRev = new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(`Revenue & X · ${kt}`)
    .setDescription('_Billing uses dashboard-style estimates._')
    .addFields(
      {
        name: 'Subscriptions & cash',
        value: truncateEmbedField(billingLines),
        inline: false
      },
      {
        name: 'X posting · audit',
        value: buildXAuditFieldValue(xs, ctx, opsKeys, engagementKeys, manualKeys),
        inline: false
      }
    );

  const embedPerf = new EmbedBuilder()
    .setColor(0x6366f1)
    .setTitle(`Performance · ${kt}`)
    .setDescription(perfCaption)
    .addFields({
      name: 'Window vs all-time',
      value: truncateEmbedField(formatPerfMarkdownTable(kind, ctx.perfWindow, ctx.perfAllTime)),
      inline: false
    });

  attachFooter(embedOps);
  attachFooter(embedRev);
  attachFooter(embedPerf);

  return [embedOps, embedRev, embedPerf];
}

async function loadScheduleState() {
  try {
    const j = await readJson(SCHEDULE_STATE_PATH);
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

async function saveScheduleState(state) {
  await writeJson(SCHEDULE_STATE_PATH, state);
}

/**
 * @param {import('discord.js').Client} client
 * @param {string} ownerId
 * @param {'daily' | 'weekly' | 'monthly'} kind
 */
async function sendAdminReport(client, ownerId, kind) {
  const owner = String(ownerId || '').trim();
  if (!owner) return;

  try {
    const tz = resolveAdminTimeZone();
    const untilMs = Date.now();
    const { sinceMs, untilMs: untilResolved, label } = resolveReportWindow(kind, untilMs, tz);

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

    let perfAllTime;
    let perfWindow;
    try {
      perfAllTime = computePerformanceStats();
      perfWindow = computePerformanceStatsWindow(sinceMs, untilResolved);
    } catch (e) {
      console.error('[AdminReports] Performance stats failed:', e.message || e);
      perfAllTime = computePerformanceStatsForCalls(getAllTrackedCalls());
      perfWindow = computePerformanceStatsForCalls([]);
    }

    let rejection = { denied: 0, excluded: 0, noteSummary: '—' };
    try {
      rejection = computeRejectionBreakdown();
    } catch (e) {
      console.error('[AdminReports] Rejection breakdown failed:', e.message || e);
    }

    let volWindow = { bot: 0, user: 0, watch: 0, total: 0 };
    try {
      volWindow = computeCallVolumeWindow(sinceMs, untilResolved);
    } catch (e) {
      console.error('[AdminReports] Volume window failed:', e.message || e);
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

    /** @type {import('./adminBillingStats').AdminBillingSnapshot} */
    let billing = {
      ok: false,
      activeSubscriptions: 0,
      approxMrrUsd: 0,
      planMixLines: [],
      windowEventCount: 0,
      windowGrossUsdFromCents: 0,
      pendingSolInvoices: null,
      paymentChannelMix: {}
    };
    try {
      billing = await fetchAdminBillingSnapshot(sinceMs, untilResolved);
    } catch (e) {
      console.error('[AdminReports] Billing snapshot failed:', e.message || e);
    }

    let xEvents = [];
    try {
      xEvents = await loadXPostAuditEventsSince(sinceMs, untilResolved);
    } catch (e) {
      console.error('[AdminReports] X audit load failed:', e.message || e);
    }
    const xSummary = summarizeXPostAudit(xEvents);

    const embeds = buildAdminReportEmbeds(kind, {
      tz,
      windowLabel: label,
      system,
      rejection,
      modWindow,
      volWindow,
      perfWindow,
      perfAllTime,
      billing,
      xSummary,
      xEventsLen: xEvents.length
    });

    try {
      const user = await client.users.fetch(owner);
      await user.send({ embeds });
      console.log(`[AdminReports] Sent ${kind} report (${embeds.length} embeds) · ${label}`);
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
  const ownerId = String(process.env.BOT_OWNER_ID ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '');
  if (!ownerId) {
    console.log('[AdminReports] BOT_OWNER_ID not set; scheduled reports disabled');
    return;
  }

  const tz = resolveAdminTimeZone();
  const hour = resolveLocalReportHour();
  console.log(
    `[AdminReports] Calendar sends enabled · TZ=${tz} · localHour=${hour} · owner=${ownerId.slice(0, 6)}…`
  );

  const tick = async () => {
    try {
      const wall = zonedWallParts(Date.now(), tz);
      if (wall.hour !== hour || wall.minute > 12) {
        return;
      }

      /** @type {{ lastDailyYmd?: string, lastWeeklyYmd?: string, lastMonthlyYm?: string }} */
      const state = await loadScheduleState();
      const next = {
        lastDailyYmd: String(state.lastDailyYmd || ''),
        lastWeeklyYmd: String(state.lastWeeklyYmd || ''),
        lastMonthlyYm: String(state.lastMonthlyYm || '')
      };

      if (next.lastDailyYmd !== wall.ymd) {
        next.lastDailyYmd = wall.ymd;
        await saveScheduleState(next);
        await sendAdminReport(client, ownerId, 'daily');
      }

      if (wall.weekday === 'Monday' && next.lastWeeklyYmd !== wall.ymd) {
        next.lastWeeklyYmd = wall.ymd;
        await saveScheduleState(next);
        await sendAdminReport(client, ownerId, 'weekly');
      }

      if (wall.day === 1 && next.lastMonthlyYm !== wall.ym) {
        next.lastMonthlyYm = wall.ym;
        await saveScheduleState(next);
        await sendAdminReport(client, ownerId, 'monthly');
      }
    } catch (e) {
      console.error('[AdminReports] scheduler:', e?.message || e);
    }
  };

  setInterval(() => {
    void tick();
  }, 60 * 1000);

  void tick();

  console.log('[AdminReports] Scheduler: daily · weekly (Mon) · monthly (1st) at local hour');
}

module.exports = {
  startAdminReports,
  sendAdminReport,
  computeSystemStats
};
