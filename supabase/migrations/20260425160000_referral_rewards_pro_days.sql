-- Referral rewards (Phase 1): grant referrers extra Pro days when a referred user activates a subscription.
-- This is intentionally non-cash and is enforced via an idempotent ledger row.

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Referrer (who gets the reward) and referee (who triggered it).
  owner_discord_id text not null,
  referred_user_id text not null,

  reward_key text not null, -- e.g. 'pro_days_on_first_subscription'
  award_days integer not null check (award_days > 0),

  -- Optional linkage to the event that triggered the reward.
  source_invoice_id uuid,
  source text, -- e.g. 'reconcile-subscriptions' | 'voucher-checkout'

  note text
);

create index if not exists referral_rewards_owner_created_idx
  on public.referral_rewards (owner_discord_id, created_at desc);

create index if not exists referral_rewards_referred_created_idx
  on public.referral_rewards (referred_user_id, created_at desc);

-- One reward per referred user per reward_key (idempotency).
create unique index if not exists referral_rewards_once_per_referred_key
  on public.referral_rewards (referred_user_id, reward_key);

alter table public.referral_rewards enable row level security;

-- No explicit RLS policies here. The dashboard uses service role for awarding.

