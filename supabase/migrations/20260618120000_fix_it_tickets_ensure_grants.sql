-- fix_it_tickets table may have been created after 20260510230000 grants ran (dashboard-only migration path).
-- Re-apply grants idempotently so PostgREST (service_role) can insert/list tickets.

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'fix_it_tickets'
  ) then
    execute 'grant select, insert, update, delete on table public.fix_it_tickets to service_role';
  end if;
end
$$;
