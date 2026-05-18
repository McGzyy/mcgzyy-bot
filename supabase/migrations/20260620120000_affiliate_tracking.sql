-- Affiliate referral links + attributions (separate from member referral credit).

alter table public.affiliate_accounts
  add column if not exists affiliate_slug text;

create unique index if not exists affiliate_accounts_slug_lower_uidx
  on public.affiliate_accounts (lower(affiliate_slug))
  where affiliate_slug is not null and btrim(affiliate_slug) <> '';

comment on column public.affiliate_accounts.affiliate_slug is
  'Vanity segment for /affiliate/r/{slug} tracking links.';

create table if not exists public.affiliate_attributions (
  referred_user_id text primary key,
  affiliate_id uuid not null references public.affiliate_accounts (id) on delete cascade,
  joined_at bigint not null,
  attribution_source text not null default 'affiliate_link'
);

create index if not exists affiliate_attributions_affiliate_idx
  on public.affiliate_attributions (affiliate_id);

comment on table public.affiliate_attributions is
  'One row per referred Discord user attributed to an affiliate partner.';

alter table public.affiliate_attributions enable row level security;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'affiliate_attributions'
  ) then
    execute 'grant select, insert, update, delete on table public.affiliate_attributions to service_role';
  end if;
end
$$;
