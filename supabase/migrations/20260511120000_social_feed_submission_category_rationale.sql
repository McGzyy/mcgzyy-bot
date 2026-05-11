-- Optional metadata for social feed source requests (mod review).

alter table public.social_feed_source_submissions
  add column if not exists category text;

alter table public.social_feed_source_submissions
  add column if not exists rationale text;
