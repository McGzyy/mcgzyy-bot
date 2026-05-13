-- Cached posts for dashboard social feed (X ingested via server; Instagram TBD).

create table if not exists public.social_feed_posts (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.social_feed_sources (id) on delete cascade,
  external_id text not null,
  text text not null,
  posted_at timestamptz not null,
  author_name text,
  author_handle text not null,
  like_count integer,
  created_at timestamptz not null default now(),
  unique (source_id, external_id)
);

create index if not exists social_feed_posts_posted_at_desc_idx
  on public.social_feed_posts (posted_at desc);

create index if not exists social_feed_posts_source_id_idx
  on public.social_feed_posts (source_id);

alter table public.social_feed_posts enable row level security;
