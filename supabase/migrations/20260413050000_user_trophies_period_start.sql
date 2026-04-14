-- Deduplicate trophies per user per leaderboard period (UTC boundary as epoch ms)

ALTER TABLE public.user_trophies
  ADD COLUMN IF NOT EXISTS period_start_ms BIGINT;

UPDATE public.user_trophies
SET period_start_ms = (
  (EXTRACT(EPOCH FROM (created_at AT TIME ZONE 'UTC')) * 1000)::bigint
)
WHERE period_start_ms IS NULL;

ALTER TABLE public.user_trophies
  ALTER COLUMN period_start_ms SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_trophies_user_timeframe_period_uniq
  ON public.user_trophies (user_id, timeframe, period_start_ms);
