-- X milestone posts: optional @mention of linked user when multiple threshold is met

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS x_milestone_tag_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS x_milestone_tag_min_multiple DOUBLE PRECISION NOT NULL DEFAULT 10;

COMMENT ON COLUMN public.users.x_milestone_tag_enabled IS 'When true and X is verified, milestone posts may @mention the user if multiple >= min threshold.';
COMMENT ON COLUMN public.users.x_milestone_tag_min_multiple IS 'Minimum call multiple (from first MC) required before @mentioning the user on X milestone posts.';
