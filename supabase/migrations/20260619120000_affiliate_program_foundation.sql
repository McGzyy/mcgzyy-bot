-- Affiliate program (separate from member referral credit v1).

create table if not exists public.affiliate_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  display_name text,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended')),
  commission_rate_bps integer not null default 1000
    check (commission_rate_bps >= 0 and commission_rate_bps <= 10000),
  totp_enabled boolean not null default false,
  totp_secret_enc text,
  totp_pending_enc text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists affiliate_accounts_email_lower_uidx
  on public.affiliate_accounts (lower(email));

comment on table public.affiliate_accounts is
  'Partner accounts with separate login (not Discord OAuth). Mandatory TOTP before dashboard access.';

create table if not exists public.affiliate_totp_session_proofs (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  trust_expires_at_ms bigint
);

create index if not exists affiliate_totp_proofs_affiliate_created_idx
  on public.affiliate_totp_session_proofs (affiliate_id, created_at desc);

create table if not exists public.affiliate_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_accounts (id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists affiliate_recovery_codes_affiliate_unused_idx
  on public.affiliate_recovery_codes (affiliate_id)
  where used_at is null;

create table if not exists public.affiliate_totp_verify_throttle (
  affiliate_id uuid primary key references public.affiliate_accounts (id) on delete cascade,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now()
);

create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_accounts (id) on delete cascade,
  referred_user_id text,
  payment_amount_cents integer,
  commission_cents integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'paid', 'voided')),
  source text,
  stripe_invoice_id text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists affiliate_commissions_idempotency_uidx
  on public.affiliate_commissions (idempotency_key)
  where idempotency_key is not null and btrim(idempotency_key) <> '';

create index if not exists affiliate_commissions_affiliate_created_idx
  on public.affiliate_commissions (affiliate_id, created_at desc);

comment on table public.affiliate_commissions is
  'Cash commission ledger for affiliates — not member referral_credit_balances.';

alter table public.affiliate_accounts enable row level security;
alter table public.affiliate_totp_session_proofs enable row level security;
alter table public.affiliate_recovery_codes enable row level security;
alter table public.affiliate_totp_verify_throttle enable row level security;
alter table public.affiliate_commissions enable row level security;

do $$
begin
  execute 'grant select, insert, update, delete on table public.affiliate_accounts to service_role';
  execute 'grant select, insert, update, delete on table public.affiliate_totp_session_proofs to service_role';
  execute 'grant select, insert, update, delete on table public.affiliate_recovery_codes to service_role';
  execute 'grant select, insert, update, delete on table public.affiliate_totp_verify_throttle to service_role';
  execute 'grant select, insert, update, delete on table public.affiliate_commissions to service_role';
end
$$;
