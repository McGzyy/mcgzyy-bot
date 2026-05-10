'use strict';

/**
 * Notify dashboard to fan out copy-trade intents for a new mirrored call (typically bot_call).
 * Set COPY_TRADE_DASHBOARD_ORIGIN (e.g. https://mcgbot.xyz) and COPY_TRADE_SIGNAL_SECRET on the bot host.
 */
function queueCopyTradeSignal(payload) {
  const origin = String(
    process.env.COPY_TRADE_DASHBOARD_ORIGIN || process.env.DASHBOARD_PUBLIC_ORIGIN || ''
  )
    .trim()
    .replace(/\/+$/, '');
  const secret = String(process.env.COPY_TRADE_SIGNAL_SECRET || '').trim();
  if (!origin || !secret) return;

  const url = `${origin}/api/internal/copy-trade-on-call`;
  const body = {
    callPerformanceId: String(payload.callPerformanceId || '').trim(),
    call_ca: String(payload.call_ca || '').trim(),
    source: String(payload.source || '').trim(),
    snapshot: payload.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : null,
  };
  if (!body.callPerformanceId || !body.call_ca) return;

  fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }).catch((err) => {
    console.error('[copyTradeSignalPush]', err?.message || err);
  });
}

module.exports = { queueCopyTradeSignal };
