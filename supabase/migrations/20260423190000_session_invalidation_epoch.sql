-- Bumped by admin "force logout all"; JWTs store this value at bind time and expire when epoch increases.

alter table public.dashboard_admin_settings
  add column if not exists session_invalidation_epoch bigint not null default 0;

comment on column public.dashboard_admin_settings.session_invalidation_epoch is
  'Incremented to invalidate all existing NextAuth JWTs until users sign in again.';
