-- Tip tracking for "Tip McGBot" (Solana Pay reference-based).

CREATE TABLE IF NOT EXISTS public.bot_tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id text NOT NULL,
  amount_sol numeric NOT NULL,
  amount_lamports bigint NOT NULL,
  reference_pubkey text NOT NULL,
  treasury_pubkey text NOT NULL,
  memo text,
  status text NOT NULL DEFAULT 'pending',
  signature text,
  from_wallet text,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);

CREATE INDEX IF NOT EXISTS bot_tips_discord_id_created_at_idx
  ON public.bot_tips(discord_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS bot_tips_reference_pubkey_uniq
  ON public.bot_tips(reference_pubkey);

