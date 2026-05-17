-- When true, the announcement bar also appears on bare layouts (verify, auth, subscribe).
-- When false, the bar only shows on the main dashboard shell (logged-in app chrome).

alter table public.dashboard_admin_settings
  add column if not exists announcement_global boolean not null default false;

comment on column public.dashboard_admin_settings.announcement_global is
  'If true, show the announcement bar on bare pages (e.g. /join/verify, /auth). Dashboard always follows announcement_enabled.';
