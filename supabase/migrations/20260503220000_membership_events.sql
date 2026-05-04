-- Unified audit trail for membership grants (SOL invoices, Stripe checkout, vouchers).
-- Inserts are idempotent where unique keys apply (see partial unique indexes).

create table if not exists public.membership_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  discord_id text not null,
  event_type text not null,
  plan_id text,
  payment_invoice_id uuid references public.payment_invoices (id) on delete set null,
  stripe_checkout_session_id text,
  stripe_subscription_id text,
  amount_cents integer,
  amount_sol numeric,
  sol_quote_usd double precision,
  tx_signature text,
  metadata jsonb
);

create index if not exists membership_events_created_at_idx on public.membership_events (created_at desc);
create index if not exists membership_events_discord_id_idx on public.membership_events (discord_id, created_at desc);

create unique index if not exists membership_events_payment_invoice_uidx
  on public.membership_events (payment_invoice_id)
  where payment_invoice_id is not null;

create unique index if not exists membership_events_stripe_checkout_uidx
  on public.membership_events (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

comment on table public.membership_events is 'Append-only log of membership access grants for admin Treasury and analytics.';

alter table public.membership_events enable row level security;
