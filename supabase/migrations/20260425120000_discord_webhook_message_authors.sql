-- Maps Discord message ids (dashboard webhook sends) to member snowflakes for profile links
-- without embedding metadata in message content.

create table if not exists public.discord_webhook_message_authors (
  message_id text primary key,
  discord_user_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists discord_webhook_message_authors_created_at_idx
  on public.discord_webhook_message_authors (created_at desc);

comment on table public.discord_webhook_message_authors is
  'Written by POST /api/chat/send after webhook execute (wait=true); read when rendering Discord chat.';

alter table public.discord_webhook_message_authors enable row level security;
