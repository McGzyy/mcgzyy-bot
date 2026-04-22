alter table public.users
  add column if not exists trusted_pro boolean not null default false;

alter table public.users
  add column if not exists trusted_pro_granted_at timestamptz;

comment on column public.users.trusted_pro is
  'Cached Discord role gate for Trusted Pro publishing. Managed by staff/automation.';

comment on column public.users.trusted_pro_granted_at is
  'When trusted_pro was last granted (best-effort; may be null for legacy users).';

