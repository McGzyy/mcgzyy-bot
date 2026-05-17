-- Sell monthly (1) and annual (12) cadences only; 3- and 6-month plans stay in DB but inactive.

update public.subscription_plans
set active = false
where billing_months not in (1, 12);

update public.subscription_plans
set sort_order = 10 + billing_months
where active = true
  and billing_months in (1, 12);

comment on table public.subscription_plans is
  'Sellable plans (active): monthly and annual per tier. product_tier=basic|pro; Pro slugs are pro-{basic-slug}.';
