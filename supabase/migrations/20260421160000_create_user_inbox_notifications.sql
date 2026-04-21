-- Persistent notifications (bell inbox) for the dashboard.

CREATE TABLE IF NOT EXISTS public.user_inbox_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'info',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS user_inbox_notifications_user_created_idx
  ON public.user_inbox_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_inbox_notifications_user_unread_idx
  ON public.user_inbox_notifications (user_id)
  WHERE read_at IS NULL;

COMMENT ON TABLE public.user_inbox_notifications IS 'Persistent dashboard notifications shown in the TopBar bell. Created server-side (admin/mod actions, system events).';

