-- Softer in-dashboard notification default (legacy DB default was 'ping' → harsh classic MP3 in app)

ALTER TABLE public.user_preferences
  ALTER COLUMN sound_type SET DEFAULT 'soft_pop';

UPDATE public.user_preferences
SET sound_type = 'soft_pop'
WHERE lower(trim(sound_type)) = 'ping';
