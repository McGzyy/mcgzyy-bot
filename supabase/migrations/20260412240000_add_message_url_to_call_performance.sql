ALTER TABLE call_performance
  ADD COLUMN IF NOT EXISTS message_url TEXT;
