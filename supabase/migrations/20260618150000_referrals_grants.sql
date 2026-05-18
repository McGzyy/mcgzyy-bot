-- Ensure PostgREST roles can read/write public.referrals (bot anon upsert + leaderboard reads).

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'referrals'
  ) then
    execute 'grant select, insert, update on table public.referrals to anon';
    execute 'grant select, insert, update on table public.referrals to authenticated';
    execute 'grant select, insert, update, delete on table public.referrals to service_role';
  end if;
end
$$;
