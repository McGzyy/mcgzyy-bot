-- Live MC multiple (current MC / MC at call) for dashboard "pulse"; updated by bot monitor.
-- ath_multiple remains peak ATH / entry for milestone-style stats.

alter table public.call_performance
  add column if not exists spot_multiple double precision not null default 1,
  add column if not exists live_market_cap_usd double precision null;

comment on column public.call_performance.spot_multiple is
  'Current MC / MC at call; bot monitoring updates alongside ath_multiple.';
comment on column public.call_performance.live_market_cap_usd is
  'Last scanned live market cap USD from the bot monitor.';
