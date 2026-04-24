-- Voice lobby moderation audit (kick / mute mic). Written by dashboard API; admin read-only in UI.

create table if not exists public.voice_moderation_audit (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_discord_id text not null,
  target_identity text not null,
  lobby_id text not null,
  room_name text not null,
  action text not null check (action in ('mute', 'kick'))
);

create index if not exists voice_moderation_audit_created_at_idx
  on public.voice_moderation_audit (created_at desc);

alter table public.voice_moderation_audit enable row level security;
