-- Full Discord CDN avatar URL from last OAuth sign-in (default embed URL when user has no custom avatar).

alter table public.users
  add column if not exists discord_avatar_url text;

comment on column public.users.discord_avatar_url is
  'Discord avatar URL at last dashboard login; used on profiles and activity when set.';
