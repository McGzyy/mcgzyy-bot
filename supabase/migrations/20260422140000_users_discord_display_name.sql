-- Discord global display name (from OAuth) for public UI vs lowercase call_performance.username

alter table public.users
  add column if not exists discord_display_name text;

comment on column public.users.discord_display_name is
  'Discord display name at last dashboard login; used on leaderboards when set.';
