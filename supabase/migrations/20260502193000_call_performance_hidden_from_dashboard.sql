-- Public dashboard: rows with hidden_from_dashboard must be omitted from profile / leaderboard queries.
ALTER TABLE public.call_performance
  ADD COLUMN IF NOT EXISTS hidden_from_dashboard boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.call_performance.hidden_from_dashboard IS
  'When true, omit from public dashboard listings. Mirrored from bot trackedCalls.hiddenFromDashboard; mint remains tracked.';
