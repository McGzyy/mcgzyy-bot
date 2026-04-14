-- User badges (e.g. top_caller, trusted_pro)

CREATE TABLE IF NOT EXISTS public.user_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  badge TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_badges_user_badge_unique UNIQUE (user_id, badge)
);

CREATE INDEX IF NOT EXISTS user_badges_user_id_idx
  ON public.user_badges (user_id);

