-- Basic vs Pro product line on subscription plans (cadence slugs stay separate).

alter table public.subscription_plans
  add column if not exists product_tier text not null default 'basic';

update public.subscription_plans
set product_tier = 'basic'
where product_tier is null or trim(product_tier) = '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subscription_plans_product_tier_check'
  ) then
    alter table public.subscription_plans
      add constraint subscription_plans_product_tier_check
      check (product_tier in ('basic', 'pro'));
  end if;
end $$;

comment on column public.subscription_plans.product_tier is
  'Product line: basic (desk membership) or pro (credit-heavy features). Billing cadence is still per slug.';
