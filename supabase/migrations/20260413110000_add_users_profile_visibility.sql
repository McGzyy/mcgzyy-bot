-- Profile module visibility settings (public-facing)

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS profile_visibility JSONB NOT NULL DEFAULT '{
    "show_stats": true,
    "show_trophies": true,
    "show_calls": true,
    "show_key_stats": true,
    "show_pinned_call": true
  }'::jsonb;

