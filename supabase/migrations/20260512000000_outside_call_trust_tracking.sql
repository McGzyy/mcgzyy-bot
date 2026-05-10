-- Per-call trust tracking (ATH ladder + one-shot defined failure) + append-only audit trail.

alter table public.outside_calls
  add column if not exists trust_max_ath_multiple double precision not null default 0,
  add column if not exists trust_upside_awarded int not null default 0,
  add column if not exists trust_failure_applied boolean not null default false,
  add column if not exists trust_failure_reason text,
  add column if not exists entry_mcap_usd double precision,
  add column if not exists entry_liquidity_usd double precision;

comment on column public.outside_calls.trust_max_ath_multiple is
  'Peak ATH multiple since post (e.g. 3.25 = 3.25×). Drives idempotent upside awards.';

comment on column public.outside_calls.trust_upside_awarded is
  'Upside trust points credited so far for this call (mirror of capped ladder at trust_max_ath_multiple; max 25).';

comment on column public.outside_calls.trust_failure_applied is
  'When true, defined-failure penalty was applied once; call is closed for further trust movement.';

comment on column public.outside_calls.trust_failure_reason is
  'Machine-readable reason, e.g. below_2x_pair_dead, explicit.';

create table if not exists public.outside_trust_score_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.outside_x_sources (id) on delete cascade,
  call_id uuid references public.outside_calls (id) on delete set null,
  delta int not null,
  trust_after int not null,
  kind text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists outside_trust_score_events_source_created_idx
  on public.outside_trust_score_events (source_id, created_at desc);

create index if not exists outside_trust_score_events_call_idx
  on public.outside_trust_score_events (call_id, created_at desc);

comment on table public.outside_trust_score_events is
  'Append-only log of trust score changes for Outside X sources (upside tiers + defined failure).';
