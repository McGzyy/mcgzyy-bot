-- Daily wallet balance snapshots for dashboard Wallet PnL widget.
-- Captured on-demand (server API) and later can be filled by a cron.

CREATE TABLE IF NOT EXISTS public.dashboard_wallet_balance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL,
  wallet_pubkey TEXT NOT NULL,
  day DATE NOT NULL,
  sol_balance NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dashboard_wallet_balance_snapshots_unique UNIQUE (discord_id, day)
);

CREATE INDEX IF NOT EXISTS dashboard_wallet_balance_snapshots_wallet_day_idx
  ON public.dashboard_wallet_balance_snapshots (wallet_pubkey, day DESC);

