-- Dashboard-only alert preferences (general toggles + token rules). Persistence for future evaluation.

ALTER TABLE public.user_dashboard_settings
  ADD COLUMN IF NOT EXISTS alert_prefs JSONB DEFAULT '{}'::jsonb;
