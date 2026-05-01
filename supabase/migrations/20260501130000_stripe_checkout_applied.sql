-- Idempotency for Stripe Checkout: webhook + verify-session may both run.
create table if not exists public.stripe_checkout_applied (
  checkout_session_id text primary key,
  discord_id text not null,
  applied_at timestamptz not null default now()
);

create index if not exists stripe_checkout_applied_discord_id_idx on public.stripe_checkout_applied (discord_id);
