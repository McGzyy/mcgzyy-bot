-- Referral ledger: record qualifying paid-invoice events as pending (no automatic Pro extension until policy exists).

alter table public.referral_rewards
  add column if not exists status text not null default 'pending';

alter table public.referral_rewards
  add column if not exists referee_period_days integer;

comment on column public.referral_rewards.status is
  'pending = qualifying event recorded; granted/voided reserved for when a reward policy is applied manually or by batch.';

comment on column public.referral_rewards.referee_period_days is
  'Plan period days for the referee payment that triggered this row (audit; no automatic conversion yet).';

-- Historical rows that already carried a day credit are treated as applied under the old auto-grant model.
update public.referral_rewards
   set status = 'granted'
 where award_days is not null
   and award_days > 0;

alter table public.referral_rewards
  alter column award_days drop not null;

alter table public.referral_rewards drop constraint if exists referral_rewards_award_days_check;

alter table public.referral_rewards
  add constraint referral_rewards_award_days_chk
  check (award_days is null or award_days > 0);

alter table public.referral_rewards drop constraint if exists referral_rewards_status_chk;

alter table public.referral_rewards
  add constraint referral_rewards_status_chk
  check (status in ('pending', 'granted', 'voided'));

-- Pending rows do not carry a day amount until a policy applies.
update public.referral_rewards
   set award_days = null
 where status = 'pending';
