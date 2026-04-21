-- Reporting systems: profile reports, call reports, and bug reports.

CREATE TABLE IF NOT EXISTS public.user_profile_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT NULL,
  evidence_urls JSONB NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | reviewing | resolved | rejected
  staff_notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ NULL,
  reviewed_by_discord_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS user_profile_reports_status_created_idx
  ON public.user_profile_reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS user_profile_reports_target_idx
  ON public.user_profile_reports (target_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.call_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id TEXT NOT NULL,
  call_performance_id UUID NOT NULL REFERENCES public.call_performance (id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT NULL,
  evidence_urls JSONB NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | reviewing | resolved | rejected
  staff_notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ NULL,
  reviewed_by_discord_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS call_reports_status_created_idx
  ON public.call_reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS call_reports_call_idx
  ON public.call_reports (call_performance_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bug_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reproduction_steps TEXT NULL,
  page_url TEXT NULL,
  screenshot_urls JSONB NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | triaged | closed
  staff_notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ NULL,
  closed_by_discord_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS bug_reports_status_created_idx
  ON public.bug_reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS bug_reports_reporter_idx
  ON public.bug_reports (reporter_user_id, created_at DESC);

COMMENT ON TABLE public.user_profile_reports IS 'User-submitted reports against a profile (rugs, harassment, FUD, etc). Reviewed by staff in dashboard moderation tools.';
COMMENT ON TABLE public.call_reports IS 'User-submitted reports against a call_performance row (scam/rug/bundle). Reviewed by staff; may result in excluding call from stats.';
COMMENT ON TABLE public.bug_reports IS 'User-submitted bug reports. Closed by admin; closing sends a persistent inbox notification to reporter.';

