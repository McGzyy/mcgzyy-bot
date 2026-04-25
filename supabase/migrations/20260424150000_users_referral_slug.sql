-- Vanity segment for https://mcgbot.xyz/ref/{slug}; discord_id URL remains fallback.

alter table public.users
  add column if not exists referral_slug text,
  add column if not exists referral_slug_changed_at timestamptz;

comment on column public.users.referral_slug is
  'Lowercase [a-z0-9-] vanity for /ref/{slug}; null = only numeric discord id link.';
comment on column public.users.referral_slug_changed_at is
  'Last slug mutation (set/clear/change); enforces 30-day cooldown.';

-- Normalized slug uniqueness (application stores lowercase only).
create unique index if not exists users_referral_slug_lower_unique
  on public.users (lower(referral_slug))
  where referral_slug is not null and btrim(referral_slug) <> '';

alter table public.users drop constraint if exists users_referral_slug_format_chk;
alter table public.users
  add constraint users_referral_slug_format_chk
  check (
    referral_slug is null
    or (
      length(referral_slug) >= 3
      and length(referral_slug) <= 32
      and referral_slug = lower(referral_slug)
      and referral_slug !~ '[^a-z0-9-]'
      and referral_slug !~ '--'
      and referral_slug ~ '^[a-z0-9]'
      and referral_slug ~ '[a-z0-9]$'
    )
  );
