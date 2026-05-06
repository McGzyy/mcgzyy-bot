-- User-facing journal title (optional). Falls back to token name / symbol in UI when null.

ALTER TABLE public.trade_journal_entries
  ADD COLUMN IF NOT EXISTS entry_title TEXT;

COMMENT ON COLUMN public.trade_journal_entries.entry_title IS 'Optional display title for the journal entry.';
