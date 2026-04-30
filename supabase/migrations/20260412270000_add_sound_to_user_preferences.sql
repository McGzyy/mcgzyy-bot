-- Notification sound preferences

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS sound_enabled BOOLEAN DEFAULT TRUE;

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS sound_type TEXT DEFAULT 'soft_chime';
