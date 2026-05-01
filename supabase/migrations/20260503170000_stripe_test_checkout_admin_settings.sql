-- Optional $1 (or any) Stripe test checkout on /subscribe — toggled in dashboard_admin_settings.
alter table public.dashboard_admin_settings
  add column if not exists stripe_test_checkout_enabled boolean not null default false;

alter table public.dashboard_admin_settings
  add column if not exists stripe_test_price_id text;

alter table public.dashboard_admin_settings
  add column if not exists stripe_test_plan_id uuid references public.subscription_plans (id);

comment on column public.dashboard_admin_settings.stripe_test_checkout_enabled is
  'When true, /subscribe shows a secondary Stripe checkout using stripe_test_price_id (public site-flags).';

comment on column public.dashboard_admin_settings.stripe_test_price_id is
  'Stripe recurring Price ID (price_…) for test checkout; must match STRIPE_SECRET_KEY mode (test vs live).';

comment on column public.dashboard_admin_settings.stripe_test_plan_id is
  'subscription_plans.id written into checkout metadata for webhooks; if null, server falls back to slug monthly.';
