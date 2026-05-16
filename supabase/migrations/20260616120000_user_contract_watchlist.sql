-- Per-user contract watchlist (CA + private/public scope). Used by dashboard /api/me/watchlist.

CREATE TABLE IF NOT EXISTS public.user_contract_watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id text NOT NULL,
  contract_address text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('private', 'public')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_contract_watchlist_unique UNIQUE (discord_id, contract_address, scope)
);

CREATE INDEX IF NOT EXISTS idx_user_contract_watchlist_discord_scope
  ON public.user_contract_watchlist (discord_id, scope, created_at DESC);
