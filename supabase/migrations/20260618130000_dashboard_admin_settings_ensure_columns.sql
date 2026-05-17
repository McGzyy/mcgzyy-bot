-- Idempotent columns for dashboard_admin_settings (safe to re-run on prod).

alter table public.dashboard_admin_settings
  add column if not exists announcement_global boolean not null default false;

alter table public.dashboard_admin_settings
  add column if not exists social_feed_enabled boolean not null default false;

comment on column public.dashboard_admin_settings.announcement_global is
  'If true, show the announcement bar on bare pages (e.g. /join/verify, /auth).';

comment on column public.dashboard_admin_settings.social_feed_enabled is
  'When true, home Social Feed panel and X timeline ingest are enabled.';
