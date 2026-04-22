create table if not exists public.user_presence (
  user_id uuid primary key references public.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

create index if not exists user_presence_last_seen_at_idx
  on public.user_presence (last_seen_at desc);

