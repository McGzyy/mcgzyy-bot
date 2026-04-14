-- Add call distribution module visibility

ALTER TABLE public.users
  ALTER COLUMN profile_visibility SET DEFAULT '{
    "show_stats": true,
    "show_trophies": true,
    "show_calls": true,
    "show_key_stats": true,
    "show_pinned_call": true,
    "show_distribution": true
  }'::jsonb;

UPDATE public.users
SET profile_visibility = jsonb_set(
  profile_visibility,
  '{show_distribution}',
  'true'::jsonb,
  true
)
WHERE (profile_visibility ? 'show_distribution') IS FALSE;

