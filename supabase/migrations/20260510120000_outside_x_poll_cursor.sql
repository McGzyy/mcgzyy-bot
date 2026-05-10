-- Cursor for Outside Calls X poller (per allow-listed source).
alter table public.outside_x_sources
  add column if not exists outside_poll_since_tweet_id text;

comment on column public.outside_x_sources.outside_poll_since_tweet_id is
  'Last X tweet id fully handled by the outside-calls poller (snowflake string). Null: next poll primes from newest tweet only (no backlog ingest).';
