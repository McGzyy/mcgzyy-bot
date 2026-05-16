-- Site-wide social feed: dashboard panel + X bearer ingest (off by default to save API credits).

alter table public.dashboard_admin_settings
  add column if not exists social_feed_enabled boolean not null default false;

comment on column public.dashboard_admin_settings.social_feed_enabled is
  'When true, home dashboard shows Social Feed and /api/social-feed may refresh X posts (Bearer). When false, panel hidden and no X reads.';
