-- Optional metrics for public Trusted Pro stats (populated later by bot/cron).

alter table public.trusted_pro_calls
  add column if not exists call_market_cap_usd numeric;

alter table public.trusted_pro_calls
  add column if not exists ath_multiple numeric;

alter table public.trusted_pro_calls
  add column if not exists ath_reached_at timestamptz;

alter table public.trusted_pro_calls
  add column if not exists time_to_ath_ms bigint;

