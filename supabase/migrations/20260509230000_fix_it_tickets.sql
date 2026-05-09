-- Beta / tester feedback: lightweight "fix-it" tickets (UI, ideas, prefs) — separate from formal bug_reports.

CREATE TABLE IF NOT EXISTS public.fix_it_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_discord_id TEXT NOT NULL,
  reporter_username TEXT NULL,
  page_path TEXT NOT NULL,
  page_key TEXT NOT NULL,
  page_label TEXT NOT NULL,
  ticket_type TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT NULL,
  user_agent TEXT NULL,
  allow_contact BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'open',
  staff_notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fix_it_tickets_ticket_type_chk CHECK (
    ticket_type IN ('ui_ux', 'idea', 'opinion', 'preference', 'workflow', 'broken', 'other')
  ),
  CONSTRAINT fix_it_tickets_status_chk CHECK (status IN ('open', 'triaged', 'done', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS fix_it_tickets_status_created_idx
  ON public.fix_it_tickets (status, created_at DESC);

CREATE INDEX IF NOT EXISTS fix_it_tickets_reporter_idx
  ON public.fix_it_tickets (reporter_discord_id, created_at DESC);

COMMENT ON TABLE public.fix_it_tickets IS 'Temporary tester feedback (build phase). Distinct from bug_reports in Settings.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'fix-it-tickets',
  'fix-it-tickets',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "fix_it_tickets_public_read" ON storage.objects;
CREATE POLICY "fix_it_tickets_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'fix-it-tickets');
