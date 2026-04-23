-- Dashboard tutorial mode persistence

alter table public.users
  add column if not exists tutorial_seen_at timestamptz;

alter table public.users
  add column if not exists tutorial_version integer not null default 1;

alter table public.users
  add column if not exists tutorial_completed_sections jsonb not null default '[]'::jsonb;

comment on column public.users.tutorial_seen_at is
  'When the user first saw (or skipped) the dashboard tutorial.';

comment on column public.users.tutorial_version is
  'Tutorial schema/version last applied to this user. Bumping server version may re-trigger tour.';

comment on column public.users.tutorial_completed_sections is
  'JSON array of completed tutorial section ids (strings).';

