-- Mirror each active Basic billing plan with a Pro counterpart (same cadence, higher tier).
-- Stripe Price IDs must be set in Admin → subscription plans or Stripe dashboard before checkout.

update public.subscription_plans
set product_tier = 'basic'
where product_tier is null
   or (product_tier <> 'pro' and slug not like 'pro-%');

update public.subscription_plans
set product_tier = 'pro'
where slug like 'pro-%';

insert into public.subscription_plans (
  slug,
  label,
  billing_months,
  duration_days,
  price_usd,
  discount_percent,
  sort_order,
  active,
  product_tier
)
select
  'pro-' || p.slug,
  'Pro — ' || p.label,
  p.billing_months,
  p.billing_months * 30,
  round((p.price_usd * 1.65)::numeric, 2),
  p.discount_percent,
  p.sort_order + 100,
  p.active,
  'pro'
from public.subscription_plans p
where coalesce(p.product_tier, 'basic') = 'basic'
  and p.slug not like 'pro-%'
  and not exists (
    select 1 from public.subscription_plans x where x.slug = 'pro-' || p.slug
  );

comment on table public.subscription_plans is
  'Sellable plans. product_tier=basic|pro; Pro slugs are pro-{basic-slug}. Set stripe_price_id per row for Stripe checkout.';
