-- Per X source: when true, user timeline ingest excludes replies (top-level posts only).

alter table public.social_feed_sources
  add column if not exists x_exclude_replies boolean not null default false;

comment on column public.social_feed_sources.x_exclude_replies is
  'X only: when true, /2/users/:id/tweets uses exclude=replies so the dashboard social feed shows original posts, not replies.';
