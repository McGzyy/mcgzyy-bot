-- User-submitted feature requests (admin triage; close pings reporter inbox).

CREATE TABLE IF NOT EXISTS public.feature_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  use_case TEXT NULL,
  page_url TEXT NULL,
  screenshot_urls JSONB NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | triaged | closed
  staff_notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ NULL,
  closed_by_discord_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS feature_requests_status_created_idx
  ON public.feature_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS feature_requests_reporter_idx
  ON public.feature_requests (reporter_user_id, created_at DESC);

COMMENT ON TABLE public.feature_requests IS 'User-submitted feature ideas. Closed by admin; closing sends a persistent inbox notification to reporter.';
