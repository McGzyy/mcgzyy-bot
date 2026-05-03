-- One verified Solana wallet per Discord user; each pubkey at most one user at a time.

CREATE TABLE IF NOT EXISTS public.wallet_link_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wallet_link_challenges_discord_idx
  ON public.wallet_link_challenges (discord_id);

CREATE INDEX IF NOT EXISTS wallet_link_challenges_expires_idx
  ON public.wallet_link_challenges (expires_at);

CREATE TABLE IF NOT EXISTS public.dashboard_linked_wallets (
  discord_id TEXT PRIMARY KEY,
  chain TEXT NOT NULL DEFAULT 'solana',
  wallet_pubkey TEXT NOT NULL UNIQUE,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dashboard_linked_wallets_pubkey_idx
  ON public.dashboard_linked_wallets (wallet_pubkey);

COMMENT ON TABLE public.dashboard_linked_wallets IS 'User-verified Solana wallet linked to Discord for dashboard display, tips, and payouts.';
COMMENT ON TABLE public.wallet_link_challenges IS 'Short-lived nonces for sign-message wallet verification.';
