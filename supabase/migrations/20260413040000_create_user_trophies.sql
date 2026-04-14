-- Trophy placements per user (e.g. daily / weekly / monthly top 3)

CREATE TABLE IF NOT EXISTS public.user_trophies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  timeframe TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_trophies_rank_check CHECK (rank IN (1, 2, 3))
);

CREATE INDEX IF NOT EXISTS user_trophies_user_id_idx
  ON public.user_trophies (user_id);

CREATE INDEX IF NOT EXISTS user_trophies_timeframe_idx
  ON public.user_trophies (timeframe);
