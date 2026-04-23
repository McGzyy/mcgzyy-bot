-- Optional CTA button for announcement bar.

alter table public.dashboard_admin_settings
  add column if not exists announcement_cta_label text;

alter table public.dashboard_admin_settings
  add column if not exists announcement_cta_url text;

comment on column public.dashboard_admin_settings.announcement_cta_label is
  'Optional announcement CTA button label (rendered when enabled and url is set).';

comment on column public.dashboard_admin_settings.announcement_cta_url is
  'Optional announcement CTA URL (https://...). Rendered on announcement bar when label is set.';

