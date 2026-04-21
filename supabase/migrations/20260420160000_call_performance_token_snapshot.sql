-- Snapshot of token identity + call-time market cap (for dashboards / activity copy).

ALTER TABLE public.call_performance
  ADD COLUMN IF NOT EXISTS token_name text,
  ADD COLUMN IF NOT EXISTS token_ticker text,
  ADD COLUMN IF NOT EXISTS call_market_cap_usd double precision;

COMMENT ON COLUMN public.call_performance.token_name IS 'Token display name at time of call (best effort).';
COMMENT ON COLUMN public.call_performance.token_ticker IS 'Ticker / symbol at time of call (best effort).';
COMMENT ON COLUMN public.call_performance.call_market_cap_usd IS 'USD market cap at call time (first-called MC).';
