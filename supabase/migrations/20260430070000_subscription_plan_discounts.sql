-- Add built-in plan discounts (percent off list price).
-- `price_usd` remains the list/base price; checkout applies `discount_percent` before vouchers.

alter table if exists public.subscription_plans
  add column if not exists discount_percent int not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'subscription_plans_discount_percent_check'
  ) then
    alter table public.subscription_plans
      add constraint subscription_plans_discount_percent_check
      check (discount_percent >= 0 and discount_percent <= 100);
  end if;
end $$;