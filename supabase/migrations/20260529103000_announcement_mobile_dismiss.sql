-- Optional mobile-only copy, hide-on-mobile, and user-dismiss (client localStorage keyed by content version).
ALTER TABLE public.dashboard_admin_settings
  ADD COLUMN IF NOT EXISTS announcement_message_mobile text,
  ADD COLUMN IF NOT EXISTS announcement_hide_on_mobile boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS announcement_allow_user_dismiss boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.dashboard_admin_settings.announcement_message_mobile IS
  'Optional shorter announcement for narrow viewports (< sm). Empty = reuse main announcement_message on mobile.';
COMMENT ON COLUMN public.dashboard_admin_settings.announcement_hide_on_mobile IS
  'When true, the announcement bar is not shown below the sm breakpoint.';
COMMENT ON COLUMN public.dashboard_admin_settings.announcement_allow_user_dismiss IS
  'When true, clients may show a dismiss control; dismissal persists in localStorage until announcement content changes.';
