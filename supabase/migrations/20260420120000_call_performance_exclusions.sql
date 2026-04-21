-- Per-call exclusion controls for stats/leaderboards without deleting history.
-- Admins can exclude rows (rugs, scams, outliers) so they no longer affect aggregates.

ALTER TABLE public.call_performance
  ADD COLUMN IF NOT EXISTS excluded_from_stats boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS excluded_reason text,
  ADD COLUMN IF NOT EXISTS excluded_at timestamptz,
  ADD COLUMN IF NOT EXISTS excluded_by_discord_id text;

