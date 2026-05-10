-- Copy trade: optional manual approval + audit for non-staff users (staff/trusted_pro bypass in app).

alter table public.users
  add column if not exists copy_trade_access_state text not null default 'none'
    check (copy_trade_access_state in ('none', 'pending', 'approved', 'denied')),
  add column if not exists copy_trade_access_requested_at timestamptz,
  add column if not exists copy_trade_access_decided_at timestamptz,
  add column if not exists copy_trade_access_decided_by text;

create index if not exists users_copy_trade_access_pending_idx
  on public.users (copy_trade_access_requested_at desc)
  where copy_trade_access_state = 'pending';

comment on column public.users.copy_trade_access_state is
  'none=no request; pending=awaiting staff; approved|denied=last decision for copy trade (non-staff gate).';
