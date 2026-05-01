-- Read-only voucher validation (no use consumed). Used before complimentary redeem to avoid burning partial codes.
create or replace function public.peek_voucher(p_code text, p_plan_slug text)
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
   where lower(code) = lower(btrim(p_code));

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

  return query
    select v.percent_off, v.duration_days_override;
end;
$$;

revoke all on function public.peek_voucher(text, text) from public;
