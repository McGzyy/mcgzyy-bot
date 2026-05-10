-- Outside Calls (v1): X-only monitored sources, two-step staff approvals, call tape rows.
-- Trust / suspension automation is documented on columns and enforced by workers/jobs later.

create table if not exists public.outside_x_sources (
  id uuid primary key default gen_random_uuid(),
  x_handle_normalized text not null,
  display_name text not null,
  trust_score int not null default 50
    check (trust_score >= 25 and trust_score <= 100),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'removed')),
  suspension_review_pending boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists outside_x_sources_handle_active_unique
  on public.outside_x_sources (x_handle_normalized)
  where status in ('active', 'suspended');

create index if not exists outside_x_sources_status_idx
  on public.outside_x_sources (status, updated_at desc);

comment on table public.outside_x_sources is
  'Allow-listed X accounts for Outside Calls. trust_score starts at 50, floor 25; workers adjust on call outcomes.';

comment on column public.outside_x_sources.suspension_review_pending is
  'Set when trust_score crosses below the review threshold (e.g. 35) pending staff decision.';

create table if not exists public.outside_source_submissions (
  id uuid primary key default gen_random_uuid(),
  submitter_discord_id text not null,
  proposed_x_handle text not null,
  proposed_display_name text not null,
  submitter_note text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  approver_1_discord_id text,
  approver_1_at timestamptz,
  approver_2_discord_id text,
  approver_2_at timestamptz,
  resolved_source_id uuid references public.outside_x_sources (id) on delete set null,
  resolved_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outside_source_submissions_approvers_distinct_chk
    check (
      approver_2_discord_id is null
      or approver_1_discord_id is null
      or approver_1_discord_id <> approver_2_discord_id
    )
);

create index if not exists outside_source_submissions_status_idx
  on public.outside_source_submissions (status, created_at desc);

create index if not exists outside_source_submissions_submitter_resolved_idx
  on public.outside_source_submissions (submitter_discord_id, resolved_at desc)
  where status = 'approved';

create unique index if not exists outside_source_submissions_pending_handle_unique
  on public.outside_source_submissions (proposed_x_handle)
  where status = 'pending';

comment on table public.outside_source_submissions is
  'Community proposals for new X monitors. Requires two distinct staff approvers (neither may be the submitter).';

create table if not exists public.outside_calls (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.outside_x_sources (id) on delete cascade,
  mint text not null,
  call_role text not null check (call_role in ('primary', 'echo')),
  primary_call_id uuid references public.outside_calls (id) on delete set null,
  tweet_id text,
  x_post_url text,
  posted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists outside_calls_posted_idx
  on public.outside_calls (posted_at desc);

create index if not exists outside_calls_source_idx
  on public.outside_calls (source_id, posted_at desc);

create index if not exists outside_calls_mint_idx
  on public.outside_calls (mint, posted_at desc);

create unique index if not exists outside_calls_tweet_unique
  on public.outside_calls (tweet_id)
  where tweet_id is not null and length(trim(tweet_id)) > 0;

comment on column public.outside_calls.call_role is
  'primary = first outside post on this mint in the pipeline; echo = later sources on same mint (still shown, not attached for milestones).';
