-- Key/value for dashboard feature flags (read/written via service-role API routes only).
create table if not exists public.dashboard_kv (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.dashboard_kv enable row level security;

comment on table public.dashboard_kv is
  'Small feature toggles and config strings. Access only through Next.js routes using SUPABASE_SERVICE_ROLE_KEY.';

insert into public.dashboard_kv (key, value)
values ('fix_it_tickets_module_enabled', 'true')
on conflict (key) do nothing;
