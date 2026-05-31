-- X automation admin columns (requires dashboard_admin_settings — see 20260419170000_create_dashboard_admin_settings.sql).

alter table public.dashboard_admin_settings
  add column if not exists x_automation_paused boolean not null default false;

alter table public.dashboard_admin_settings
  add column if not exists x_scheduled_digests_enabled boolean not null default false;

comment on column public.dashboard_admin_settings.x_automation_paused is
  'When true, bot skips all automated X reads (outside poll, mention poll) and writes (milestones, digests).';

comment on column public.dashboard_admin_settings.x_scheduled_digests_enabled is
  'When true and x_automation_paused is false, bot posts daily / 7d / monthly leaderboard digests on schedule.';
