-- Dedupe table for dashboard alert evaluation (inbox delivery v1).

CREATE TABLE IF NOT EXISTS public.dashboard_alert_fires (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  rule_id TEXT NULL,
  fire_key TEXT NOT NULL,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, fire_key)
);

CREATE INDEX IF NOT EXISTS dashboard_alert_fires_user_fired_idx
  ON public.dashboard_alert_fires (user_id, fired_at DESC);

COMMENT ON TABLE public.dashboard_alert_fires IS
  'One row per fired dashboard alert; unique (user_id, fire_key) prevents inbox spam from cron re-runs.';
