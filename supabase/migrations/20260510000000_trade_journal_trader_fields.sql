-- Enrich dashboard trade journal entries (discord_user_id schema) with trader-focused fields.

ALTER TABLE public.trade_journal_entries
  ADD COLUMN IF NOT EXISTS entry_mcap_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS exit_mcap_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS exit_mcaps_note TEXT,
  ADD COLUMN IF NOT EXISTS profit_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS profit_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS thesis TEXT,
  ADD COLUMN IF NOT EXISTS narrative TEXT,
  ADD COLUMN IF NOT EXISTS entry_justification TEXT,
  ADD COLUMN IF NOT EXISTS planned_invalidation TEXT,
  ADD COLUMN IF NOT EXISTS lessons_learned TEXT,
  ADD COLUMN IF NOT EXISTS token_symbol TEXT,
  ADD COLUMN IF NOT EXISTS token_name TEXT,
  ADD COLUMN IF NOT EXISTS timeframe TEXT,
  ADD COLUMN IF NOT EXISTS position_size_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS entry_price_usd NUMERIC,
  ADD COLUMN IF NOT EXISTS exit_price_usd NUMERIC;

COMMENT ON COLUMN public.trade_journal_entries.entry_mcap_usd IS 'Approx market cap at entry (USD).';
COMMENT ON COLUMN public.trade_journal_entries.exit_mcap_usd IS 'Primary exit market cap (USD); use exit_mcaps_note for scales/partials.';
COMMENT ON COLUMN public.trade_journal_entries.exit_mcaps_note IS 'Freeform: multiple exits, partials, or MC path.';
COMMENT ON COLUMN public.trade_journal_entries.thesis IS 'Why you took the trade / edge thesis.';
COMMENT ON COLUMN public.trade_journal_entries.narrative IS 'What actually happened (story arc).';
COMMENT ON COLUMN public.trade_journal_entries.entry_justification IS 'Why this entry was valid (confluence, trigger).';
