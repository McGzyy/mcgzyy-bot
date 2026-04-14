-- Profile badges (admin-set or future automation)

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_top_caller BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_trusted_pro BOOLEAN NOT NULL DEFAULT FALSE;
