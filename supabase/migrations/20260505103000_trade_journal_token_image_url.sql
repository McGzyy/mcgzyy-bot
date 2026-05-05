-- Optional DexScreener / token image URL cached on journal row when mint is resolved.

ALTER TABLE public.trade_journal_entries
  ADD COLUMN IF NOT EXISTS token_image_url TEXT;

COMMENT ON COLUMN public.trade_journal_entries.token_image_url IS 'Optional token image URL (e.g. DexScreener) when mint metadata is resolved.';
