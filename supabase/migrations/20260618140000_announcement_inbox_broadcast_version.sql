-- Tracks which announcement content version was last fan-out to user_inbox_notifications.

alter table public.dashboard_admin_settings
  add column if not exists announcement_inbox_broadcast_version text null;

comment on column public.dashboard_admin_settings.announcement_inbox_broadcast_version is
  'announcement_content_version hash last pushed to all users'' bell inboxes; avoids duplicate broadcasts.';
