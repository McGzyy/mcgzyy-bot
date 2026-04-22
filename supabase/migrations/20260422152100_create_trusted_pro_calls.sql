create table if not exists public.trusted_pro_calls (
  id uuid primary key default gen_random_uuid(),
  author_discord_id text not null references public.users(discord_id) on delete cascade,
  contract_address text not null,
  thesis text not null,

  narrative text null,
  catalysts jsonb null,
  risks text null,
  time_horizon text null,
  entry_plan text null,
  invalidation text null,
  sources jsonb null,
  tags jsonb null,

  status text not null default 'pending', -- pending | approved | denied
  staff_notes text null,
  reviewed_at timestamptz null,
  reviewed_by_discord_id text null,

  published_at timestamptz null,
  x_post_status text null,
  x_post_id text null,

  views_count int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trusted_pro_calls_status_created_idx
  on public.trusted_pro_calls (status, created_at desc);

create index if not exists trusted_pro_calls_author_created_idx
  on public.trusted_pro_calls (author_discord_id, created_at desc);

create index if not exists trusted_pro_calls_contract_created_idx
  on public.trusted_pro_calls (contract_address, created_at desc);

comment on table public.trusted_pro_calls is
  'Longform Trusted Pro call submissions. First 3 approved per author go through staff approval; then auto-publish.';

