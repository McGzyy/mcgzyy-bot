-- Personal trade journal (Solana) — private per Discord user; accessed only via dashboard API (service role).

CREATE TABLE IF NOT EXISTS public.trade_journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL,
  mint TEXT NOT NULL,
  token_symbol TEXT,
  token_name TEXT,
  traded_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  setup_label TEXT,
  thesis TEXT,
  planned_invalidation TEXT,
  entry_price_usd NUMERIC,
  exit_price_usd NUMERIC,
  size_usd NUMERIC,
  pnl_usd NUMERIC,
  pnl_pct NUMERIC,
  notes TEXT,
  reference_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_tx_signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS trade_journal_entries_discord_traded_idx
  ON public.trade_journal_entries (discord_id, traded_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS trade_journal_entries_discord_created_idx
  ON public.trade_journal_entries (discord_id, created_at DESC);

COMMENT ON TABLE public.trade_journal_entries IS 'User-authored Solana trade journal; not tied to call_performance or milestones.';

ALTER TABLE public.trade_journal_entries ENABLE ROW LEVEL SECURITY;
