create table if not exists public.trusted_pro_call_views (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.trusted_pro_calls(id) on delete cascade,
  viewer_discord_id text null,
  created_at timestamptz not null default now()
);

-- Prevent double-counting per authenticated viewer.
create unique index if not exists trusted_pro_call_views_unique_viewer
  on public.trusted_pro_call_views (call_id, viewer_discord_id)
  where viewer_discord_id is not null;

create index if not exists trusted_pro_call_views_call_created_idx
  on public.trusted_pro_call_views (call_id, created_at desc);

