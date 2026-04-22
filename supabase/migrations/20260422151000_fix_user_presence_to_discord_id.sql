-- Presence should key off Discord IDs because NextAuth session user.id is the Discord id.

create table if not exists public.user_presence_v2 (
  discord_id text primary key references public.users(discord_id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

create index if not exists user_presence_v2_last_seen_at_idx
  on public.user_presence_v2 (last_seen_at desc);

-- Backfill from v1 if present (best-effort).
insert into public.user_presence_v2 (discord_id, last_seen_at)
select u.discord_id, p.last_seen_at
from public.user_presence p
join public.users u on u.id = p.user_id
on conflict (discord_id) do update set last_seen_at = excluded.last_seen_at;

