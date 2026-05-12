-- Calendar billing: explicit months for SOL / voucher / referral extensions (Stripe-like).
-- `duration_days` is kept in sync as `billing_months * 30` for list-price / day display math.

alter table public.subscription_plans
  add column if not exists billing_months integer;

update public.subscription_plans
set billing_months = greatest(1, least(120, round(duration_days::numeric / 30)::integer))
where billing_months is null;

update public.subscription_plans
set billing_months = 1
where billing_months is null or billing_months < 1;

alter table public.subscription_plans
  alter column billing_months set default 1;

alter table public.subscription_plans
  alter column billing_months set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    where t.relname = 'subscription_plans' and c.conname = 'subscription_plans_billing_months_check'
  ) then
    alter table public.subscription_plans
      add constraint subscription_plans_billing_months_check
      check (billing_months >= 1 and billing_months <= 120);
  end if;
end $$;

update public.subscription_plans
set duration_days = billing_months * 30
where duration_days is distinct from billing_months * 30;

comment on column public.subscription_plans.billing_months is
  'Whole calendar months granted for SOL / complimentary / referral (matches Stripe cadence). duration_days is kept as months*30 for per-day list math.';
