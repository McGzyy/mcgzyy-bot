-- PnL Showcase: verified wallet links + computed PnL snapshots.

CREATE TABLE IF NOT EXISTS public.pnl_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id text NOT NULL,
  wallet_pubkey text NOT NULL,
  proof_nonce text NOT NULL,
  proof_signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pnl_wallets_discord_wallet_uniq
  ON public.pnl_wallets(discord_id, wallet_pubkey);

CREATE TABLE IF NOT EXISTS public.pnl_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id text NOT NULL,
  username text NOT NULL,
  wallet_pubkey text NOT NULL,
  token_ca text NOT NULL,
  verified boolean NOT NULL DEFAULT true,
  cost_basis_sol numeric NOT NULL,
  proceeds_sol numeric NOT NULL,
  realized_pnl_sol numeric NOT NULL,
  realized_pnl_pct numeric NOT NULL,
  unrealized_pnl_sol numeric NOT NULL,
  unrealized_pnl_pct numeric NOT NULL,
  qty_remaining text NOT NULL, -- integer in base units as string
  price_per_token_sol numeric,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pnl_posts_created_at_idx
  ON public.pnl_posts(created_at DESC);

CREATE INDEX IF NOT EXISTS pnl_posts_token_ca_created_at_idx
  ON public.pnl_posts(token_ca, created_at DESC);

CREATE TABLE IF NOT EXISTS public.pnl_post_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.pnl_posts(id) ON DELETE CASCADE,
  signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pnl_post_transactions_post_id_idx
  ON public.pnl_post_transactions(post_id);

