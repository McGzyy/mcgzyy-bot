-- Referral credit v1: balances, payment columns, unique referred user, redemption segment caps.

-- ---------------------------------------------------------------------------
-- referrals: ensure one attribution row per referred Discord user
-- ---------------------------------------------------------------------------
alter table if exists public.referrals
  add column if not exists attribution_source text not null default 'discord_invite';

comment on column public.referrals.attribution_source is
  'discord_invite | web_cookie_checkout | web_membership_claim — how owner was attributed.';

-- Dedupe legacy duplicates (keep newest joined_at).
delete from public.referrals a
  using public.referrals b
 where a.referred_user_id = b.referred_user_id
   and a.joined_at < b.joined_at;

create unique index if not exists referrals_referred_user_id_uidx
  on public.referrals (referred_user_id);

create index if not exists referrals_owner_discord_id_idx
  on public.referrals (owner_discord_id);

-- ---------------------------------------------------------------------------
-- referral_rewards: monetary accrual + settlement window
-- ---------------------------------------------------------------------------
alter table public.referral_rewards
  add column if not exists payment_amount_cents integer;

alter table public.referral_rewards
  add column if not exists credit_cents integer;

alter table public.referral_rewards
  add column if not exists available_at timestamptz;

alter table public.referral_rewards
  add column if not exists stripe_invoice_id text;

alter table public.referral_rewards
  add column if not exists referee_first_paid_at timestamptz;

comment on column public.referral_rewards.payment_amount_cents is
  'Gross qualifying payment in USD cents (Stripe amount_paid or SOL quote).';

comment on column public.referral_rewards.credit_cents is
  'Referrer credit granted for this row (after cap); applied to balance when status becomes granted.';

comment on column public.referral_rewards.available_at is
  'Credit becomes grantable when created_at passes refund/dispute window (server compares to now()).';

comment on column public.referral_rewards.stripe_invoice_id is
  'Stripe invoice id (in_…) when source is Stripe; complements legacy source_invoice_id.';

comment on column public.referral_rewards.referee_first_paid_at is
  'Anchor for Cap A: first paid membership timestamp for this referred_user_id (denormalized).';

create index if not exists referral_rewards_pending_available_idx
  on public.referral_rewards (status, available_at)
  where status = 'pending';

create unique index if not exists referral_rewards_stripe_invoice_uidx
  on public.referral_rewards (stripe_invoice_id)
  where stripe_invoice_id is not null and btrim(stripe_invoice_id) <> '';

-- ---------------------------------------------------------------------------
-- Spendable credit balance (USD cents)
-- ---------------------------------------------------------------------------
create table if not exists public.referral_credit_balances (
  discord_id text primary key,
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.referral_credit_balances is
  'Non-cash referral credit (USD cents). Redeemed toward subscription months at published tier prices.';

alter table public.referral_credit_balances enable row level security;

-- ---------------------------------------------------------------------------
-- Redemption totals per "segment" (exempt / discount windows) for 3-month cap
-- ---------------------------------------------------------------------------
create table if not exists public.referral_redemption_segment_totals (
  discord_id text not null,
  segment_key text not null,
  months_equivalent numeric not null default 0 check (months_equivalent >= 0),
  updated_at timestamptz not null default now(),
  primary key (discord_id, segment_key)
);

comment on table public.referral_redemption_segment_totals is
  'Months of subscription funded by referral credit per exemption/discount segment (cap 3).';

alter table public.referral_redemption_segment_totals enable row level security;
