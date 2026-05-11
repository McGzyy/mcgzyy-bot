-- HODL: verified long-hold calls tied to (discord_id, mint) and a chosen wallet scope.

CREATE TABLE IF NOT EXISTS public.hodl_linked_wallets (
  discord_id TEXT PRIMARY KEY,
  wallet_pubkey TEXT NOT NULL UNIQUE,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.hodl_linked_wallets IS
  'Optional Solana wallet linked only for HODL verification (separate from dashboard_linked_wallets).';

CREATE TABLE IF NOT EXISTS public.hodl_wallet_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hodl_wallet_challenges_discord_idx
  ON public.hodl_wallet_challenges (discord_id);

CREATE INDEX IF NOT EXISTS hodl_wallet_challenges_expires_idx
  ON public.hodl_wallet_challenges (expires_at);

CREATE TABLE IF NOT EXISTS public.hodl_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL,
  mint TEXT NOT NULL,
  wallet_pubkey TEXT NOT NULL,
  wallet_scope TEXT NOT NULL CHECK (wallet_scope IN ('dashboard', 'hodl_only')),
  status TEXT NOT NULL DEFAULT 'pending_hold' CHECK (status IN ('pending_hold', 'live', 'cancelled', 'revoked_no_balance')),
  hold_since TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  eligible_at TIMESTAMPTZ,
  live_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  narrative TEXT,
  thesis TEXT,
  mc_prediction_usd NUMERIC(24, 4),
  size_tier TEXT,
  balance_raw TEXT NOT NULL DEFAULT '0',
  token_decimals INT NOT NULL DEFAULT 6,
  token_symbol TEXT,
  price_change_pct NUMERIC(24, 6),
  last_metrics_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  CONSTRAINT hodl_calls_user_mint_unique UNIQUE (discord_id, mint)
);

CREATE INDEX IF NOT EXISTS hodl_calls_status_idx ON public.hodl_calls (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS hodl_calls_mint_idx ON public.hodl_calls (mint);

COMMENT ON COLUMN public.hodl_calls.wallet_scope IS 'dashboard = primary linked wallet; hodl_only = wallet linked via HODL flow only.';
COMMENT ON COLUMN public.hodl_calls.hold_since IS 'Approximate first on-chain activity for the SPL token account (RPC scan).';
