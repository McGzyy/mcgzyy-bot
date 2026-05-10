-- Tables created via SQL often lack GRANTs for the Supabase `service_role` used by the dashboard API.
-- Without these, PostgREST returns "permission denied" and the admin list route fails.

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'fix_it_tickets'
  ) then
    execute 'grant select, insert, update, delete on table public.fix_it_tickets to service_role';
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'dashboard_kv'
  ) then
    execute 'grant select, insert, update, delete on table public.dashboard_kv to service_role';
  end if;
end
$$;
