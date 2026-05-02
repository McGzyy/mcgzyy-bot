-- Toggle automatic Joyride tour for first-time dashboard users (callers).
alter table public.dashboard_admin_settings
  add column if not exists tutorial_auto_start_enabled boolean not null default true;

comment on column public.dashboard_admin_settings.tutorial_auto_start_enabled is
  'When false, the dashboard does not open the guided tour automatically for new users; manual start via window.__mcgbotTutorial remains available.';
