-- Stripe Billing: recurring subscriptions + Checkout Price IDs per plan.
alter table public.subscriptions
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_status text;

create unique index if not exists subscriptions_stripe_subscription_id_uidx
  on public.subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists subscriptions_stripe_customer_id_idx
  on public.subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;

alter table public.subscription_plans
  add column if not exists stripe_price_id text;

comment on column public.subscription_plans.stripe_price_id is
  'Stripe Price ID (price_...) for recurring Checkout; amount and interval are defined in Stripe.';
