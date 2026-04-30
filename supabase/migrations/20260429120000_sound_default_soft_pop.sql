-- In-dashboard notification sound_type default (see mcgbot-dashboard/lib/notificationSounds.ts).
-- Requires public.user_preferences + column sound_type (from 20260412260000 + 20260412270000).
-- If the table does not exist yet, run those migrations first, or paste their SQL in the Supabase SQL editor before this block.

DO $$
BEGIN
  IF to_regclass('public.user_preferences') IS NULL THEN
    RAISE NOTICE 'Skipped: public.user_preferences does not exist. Apply 20260412260000_create_user_preferences.sql then 20260412270000_add_sound_to_user_preferences.sql first.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_preferences'
      AND column_name = 'sound_type'
  ) THEN
    RAISE NOTICE 'Skipped: user_preferences.sound_type missing. Apply 20260412270000_add_sound_to_user_preferences.sql first.';
    RETURN;
  END IF;

  ALTER TABLE public.user_preferences
    ALTER COLUMN sound_type SET DEFAULT 'soft_chime';

  UPDATE public.user_preferences
  SET sound_type = 'soft_chime'
  WHERE lower(trim(sound_type)) IN (
    'ping',
    'gentle_bell',
    'minimal_drop',
    'glass_ping',
    'digital_tap',
    'pulse_two',
    'warm_pluck',
    'soft_pop',
    'classic',
    'marimba_pair',
    'nudge_warm'
  );
END $$;
