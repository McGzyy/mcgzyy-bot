'use strict';

const { getSupabaseServiceRole } = require('./callPerformanceLeaderboardNode');

/**
 * @typedef {{
 *   ok: boolean,
 *   reason?: string,
 *   activeSubscriptions: number,
 *   approxMrrUsd: number,
 *   planMixLines: string[],
 *   windowEventCount: number,
 *   windowGrossUsdFromCents: number,
 *   pendingSolInvoices: number | null,
 *   paymentChannelMix: Record<string, number>
 * }} AdminBillingSnapshot
 */

/**
 * Monthly-equivalent USD from plan row (approximation).
 * @param {{ price_usd?: unknown, duration_days?: unknown }} plan
 */
function monthlyUsdFromPlan(plan) {
  const price = Number(plan?.price_usd);
  const days = Number(plan?.duration_days);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(days) || days <= 0) return 0;
  return price * (30 / days);
}

/**
 * @param {number} sinceMs
 * @param {number} untilMs
 * @returns {Promise<AdminBillingSnapshot>}
 */
async function fetchAdminBillingSnapshot(sinceMs, untilMs) {
  const sb = getSupabaseServiceRole();
  if (!sb) {
    return {
      ok: false,
      reason: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing',
      activeSubscriptions: 0,
      approxMrrUsd: 0,
      planMixLines: [],
      windowEventCount: 0,
      windowGrossUsdFromCents: 0,
      pendingSolInvoices: null,
      paymentChannelMix: {}
    };
  }

  const sinceIso = new Date(sinceMs).toISOString();
  const untilIso = new Date(untilMs).toISOString();
  const nowMs = Date.now();

  /** @type {AdminBillingSnapshot} */
  const out = {
    ok: true,
    activeSubscriptions: 0,
    approxMrrUsd: 0,
    planMixLines: [],
    windowEventCount: 0,
    windowGrossUsdFromCents: 0,
    pendingSolInvoices: null,
    paymentChannelMix: {}
  };

  try {
    const { data: plans, error: planErr } = await sb
      .from('subscription_plans')
      .select('id, slug, label, price_usd, duration_days')
      .limit(200);
    if (planErr) throw planErr;

    const planMap = new Map(
      (Array.isArray(plans) ? plans : []).map(p => [
        String(p.id),
        {
          slug: String(p.slug || ''),
          label: String(p.label || p.slug || ''),
          price_usd: Number(p.price_usd),
          duration_days: Number(p.duration_days)
        }
      ])
    );

    const { data: subs, error: subErr } = await sb
      .from('subscriptions')
      .select('discord_id, plan_id, current_period_end, status, payment_channel, stripe_status')
      .limit(50000);
    if (subErr) throw subErr;

    const rows = Array.isArray(subs) ? subs : [];
    /** @type {Map<string, number>} */
    const mix = new Map();
    let approxMrr = 0;
    let active = 0;

    for (const r of rows) {
      const endMs = Date.parse(String(r.current_period_end || ''));
      const st = String(r.status || '').toLowerCase();
      const stripeSt = String(r.stripe_status || '').toLowerCase();
      const channel = String(r.payment_channel || 'unknown').trim() || 'unknown';
      const paying =
        st === 'active' &&
        Number.isFinite(endMs) &&
        endMs > nowMs &&
        (stripeSt === '' ||
          stripeSt === 'active' ||
          stripeSt === 'trialing' ||
          stripeSt === 'past_due');

      if (!paying) continue;

      active += 1;
      const pid = String(r.plan_id || '');
      const plan = planMap.get(pid);
      if (plan) {
        approxMrr += monthlyUsdFromPlan(plan);
        const label = plan.label || plan.slug || pid.slice(0, 8);
        mix.set(label, (mix.get(label) || 0) + 1);
      }
      out.paymentChannelMix[channel] = (out.paymentChannelMix[channel] || 0) + 1;
    }

    out.activeSubscriptions = active;
    out.approxMrrUsd = approxMrr;
    out.planMixLines = [...mix.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, n]) => `${label}: **${n}**`);
  } catch (e) {
    out.ok = false;
    out.reason = e?.message || String(e);
  }

  try {
    const { data: evs, error } = await sb
      .from('membership_events')
      .select('amount_cents, created_at, event_type')
      .gte('created_at', sinceIso)
      .lte('created_at', untilIso)
      .limit(5000);
    if (!error && Array.isArray(evs)) {
      out.windowEventCount = evs.length;
      let cents = 0;
      for (const e of evs) {
        const c = Number(e.amount_cents);
        if (Number.isFinite(c) && c > 0) cents += c;
      }
      out.windowGrossUsdFromCents = cents / 100;
    }
  } catch {
    /* table may not exist in older environments */
  }

  try {
    const nowIso = new Date().toISOString();
    const { count, error } = await sb
      .from('payment_invoices')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .gt('quote_expires_at', nowIso);
    if (!error && typeof count === 'number') {
      out.pendingSolInvoices = count;
    }
  } catch {
    out.pendingSolInvoices = null;
  }

  return out;
}

module.exports = {
  fetchAdminBillingSnapshot,
  monthlyUsdFromPlan
};
