-- One-time per-user "club" trophies when any eligible user call hits an ATH multiple threshold.

CREATE TABLE IF NOT EXISTS public.user_milestone_trophies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  milestone_key TEXT NOT NULL,
  call_performance_id UUID REFERENCES public.call_performance (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_milestone_trophies_user_milestone_uniq UNIQUE (user_id, milestone_key)
);

CREATE INDEX IF NOT EXISTS user_milestone_trophies_user_id_idx
  ON public.user_milestone_trophies (user_id);

COMMENT ON TABLE public.user_milestone_trophies IS 'Permanent profile trophies (e.g. 10x club); at most one row per user per milestone_key.';
COMMENT ON COLUMN public.user_milestone_trophies.milestone_key IS 'Stable id e.g. call_club_10x, call_club_25x, call_club_50x';
