-- Baseline referrals attribution table (idempotent for envs that already have it).

create table if not exists public.referrals (
  owner_discord_id text not null,
  referred_user_id text not null,
  joined_at bigint not null,
  attribution_source text not null default 'discord_invite'
);

comment on table public.referrals is
  'One row per referred Discord user; owner is the referrer at last attribution.';

comment on column public.referrals.attribution_source is
  'discord_invite | web_cookie_checkout | web_membership_claim | web_cookie_sol_checkout';

create unique index if not exists referrals_referred_user_id_uidx
  on public.referrals (referred_user_id);

create index if not exists referrals_owner_discord_id_idx
  on public.referrals (owner_discord_id);
