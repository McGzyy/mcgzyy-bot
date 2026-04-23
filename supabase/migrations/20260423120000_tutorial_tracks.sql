-- Per-track tutorial state (caller / moderator / administrator tours)

alter table public.users
  add column if not exists tutorial_tracks jsonb not null default '{}'::jsonb;

comment on column public.users.tutorial_tracks is
  'Per-track tutorial progress: { "user"?: { seenAt, version, completedSections }, "mod"?: {...}, "admin"?: {...} }. Legacy columns tutorial_seen_at / tutorial_completed_sections remain for backfill reads.';

-- One-time backfill from legacy columns into tutorial_tracks.user
update public.users u
set tutorial_tracks = jsonb_build_object(
  'user',
  jsonb_strip_nulls(
    jsonb_build_object(
      'seenAt', to_jsonb(u.tutorial_seen_at),
      'version', to_jsonb(coalesce(u.tutorial_version, 1)),
      'completedSections', coalesce(u.tutorial_completed_sections, '[]'::jsonb)
    )
  )
)
where (u.tutorial_tracks is null or u.tutorial_tracks = '{}'::jsonb)
  and (
    u.tutorial_seen_at is not null
    or jsonb_array_length(coalesce(u.tutorial_completed_sections, '[]'::jsonb)) > 0
  );
