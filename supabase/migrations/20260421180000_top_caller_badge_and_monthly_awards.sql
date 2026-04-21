-- Top Caller badge: repeat wins tracked on `user_badges.times_awarded`.
-- Idempotent monthly award via `monthly_top_caller_awards` (one row per closed month).

ALTER TABLE public.user_badges
  ADD COLUMN IF NOT EXISTS times_awarded INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.user_badges
  DROP CONSTRAINT IF EXISTS user_badges_times_awarded_check;

ALTER TABLE public.user_badges
  ADD CONSTRAINT user_badges_times_awarded_check
  CHECK (times_awarded >= 1);

CREATE TABLE IF NOT EXISTS public.monthly_top_caller_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start_ms BIGINT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monthly_top_caller_awards_period_unique UNIQUE (period_start_ms)
);

CREATE INDEX IF NOT EXISTS monthly_top_caller_awards_user_id_idx
  ON public.monthly_top_caller_awards (user_id);
