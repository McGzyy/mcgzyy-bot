-- Referral rewards: per-payment idempotency + admin-configurable "1/N of referee period" divisor.

-- How many equal slices of a referee's paid subscription period count toward the referrer's Pro extension.
-- Example: divisor = 5 and the referee pays for a 30-day period → floor(30/5) = 6 days to the referrer per renewal.
alter table public.dashboard_admin_settings
  add column if not exists referral_credit_divisor integer not null default 5
    check (referral_credit_divisor >= 1 and referral_credit_divisor <= 60);

comment on column public.dashboard_admin_settings.referral_credit_divisor is
  'Each paid referee subscription period credits the referrer with floor(duration_days / divisor) Pro days (min 1). Default 5 = one-fifth of the referee period per payment.';

-- Stable idempotency for multiple rewards per referred user (renewals).
alter table public.referral_rewards
  add column if not exists idempotency_key text;

update public.referral_rewards
   set idempotency_key = reward_key || ':' || referred_user_id
 where idempotency_key is null;

alter table public.referral_rewards
  alter column idempotency_key set not null;

drop index if exists referral_rewards_once_per_referred_key;

create unique index if not exists referral_rewards_idempotency_key_uniq
  on public.referral_rewards (idempotency_key);
