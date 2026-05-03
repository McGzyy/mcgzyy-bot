-- Solana Pay invoices for membership (see `lib/subscription/subscriptionDb.ts` + `finalizeSolInvoice`).
-- `payment_channel` records whether access is primarily driven by Stripe vs wallet SOL invoices.

create table if not exists public.payment_invoices (
  id uuid primary key default gen_random_uuid(),
  discord_id text not null,
  plan_id text not null,
  reference_pubkey text not null,
  treasury_pubkey text not null,
  lamports bigint not null,
  sol_usd double precision not null,
  quote_expires_at timestamptz not null,
  status text not null default 'pending',
  tx_signature text,
  payer_pubkey text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists payment_invoices_reference_pubkey_uniq
  on public.payment_invoices (reference_pubkey);

create index if not exists payment_invoices_discord_status_exp_idx
  on public.payment_invoices (discord_id, status, quote_expires_at desc);

alter table public.subscriptions
  add column if not exists payment_channel text not null default 'stripe';

comment on column public.subscriptions.payment_channel is
  'stripe = Stripe Billing drives renewals; sol = last purchase was Solana invoice (user confirms each renewal in wallet).';
