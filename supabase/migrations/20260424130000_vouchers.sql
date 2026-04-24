-- Voucher codes for SOL subscription checkout.
-- Supports limited uses, plan eligibility, % off, and access duration override.

create table if not exists public.vouchers (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  created_at timestamptz not null default now(),
  created_by_discord_id text,
  active boolean not null default true,
  expires_at timestamptz,
  percent_off integer not null default 0 check (percent_off >= 0 and percent_off <= 100),
  uses_total integer not null default 1 check (uses_total >= 0),
  uses_remaining integer not null default 1 check (uses_remaining >= 0),
  eligible_plan_slug text,
  duration_days_override integer
);

create unique index if not exists vouchers_code_unique on public.vouchers (lower(code));
create index if not exists vouchers_active_idx on public.vouchers (active, expires_at);

alter table public.vouchers enable row level security;

-- Atomically validate and consume one voucher use.
-- Returns percent_off and duration_days_override on success.
create or replace function public.consume_voucher(p_code text, p_plan_slug text)
returns table (percent_off integer, duration_days_override integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
begin
  if p_code is null or btrim(p_code) = '' then
    raise exception 'missing_voucher';
  end if;
  if p_plan_slug is null or btrim(p_plan_slug) = '' then
    raise exception 'missing_plan';
  end if;

  select *
    into v
    from public.vouchers
   where lower(code) = lower(btrim(p_code))
   for update;

  if not found then
    raise exception 'voucher_not_found';
  end if;
  if v.active is not true then
    raise exception 'voucher_inactive';
  end if;
  if v.expires_at is not null and v.expires_at <= now() then
    raise exception 'voucher_expired';
  end if;
  if v.uses_remaining is null or v.uses_remaining <= 0 then
    raise exception 'voucher_exhausted';
  end if;
  if v.eligible_plan_slug is not null and lower(v.eligible_plan_slug) <> lower(btrim(p_plan_slug)) then
    raise exception 'voucher_wrong_plan';
  end if;

  update public.vouchers
     set uses_remaining = uses_remaining - 1
   where id = v.id
     and uses_remaining > 0;

  if not found then
    raise exception 'voucher_exhausted';
  end if;

  return query
    select v.percent_off, v.duration_days_override;
end;
$$;

revoke all on function public.consume_voucher(text, text) from public;
