-- Social feed monitored sources + staff submission workflow.

create table if not exists public.social_feed_sources (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('x','instagram')),
  handle text not null,
  display_name text,
  created_at timestamptz not null default now(),
  created_by_discord_id text,
  active boolean not null default true,
  last_seen_post_at timestamptz
);

create unique index if not exists social_feed_sources_platform_handle_unique
  on public.social_feed_sources (platform, lower(handle));

create table if not exists public.social_feed_source_submissions (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('x','instagram')),
  handle text not null,
  display_name text,
  status text not null default 'pending' check (status in ('pending','approved','denied')),
  submitted_at timestamptz not null default now(),
  submitted_by_discord_id text not null,
  reviewed_at timestamptz,
  reviewed_by_discord_id text,
  review_note text
);

create index if not exists social_feed_source_submissions_status_idx
  on public.social_feed_source_submissions (status, submitted_at desc);

create unique index if not exists social_feed_source_submissions_pending_unique
  on public.social_feed_source_submissions (platform, lower(handle))
  where status = 'pending';

