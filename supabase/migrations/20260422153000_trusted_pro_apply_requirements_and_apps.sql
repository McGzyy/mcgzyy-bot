-- Trusted Pro application requirements (admin-configured) and application queue.

alter table public.dashboard_admin_settings
  add column if not exists trusted_pro_apply_min_total_calls int not null default 0;

alter table public.dashboard_admin_settings
  add column if not exists trusted_pro_apply_min_avg_x numeric not null default 0;

alter table public.dashboard_admin_settings
  add column if not exists trusted_pro_apply_min_win_rate numeric not null default 0;

alter table public.dashboard_admin_settings
  add column if not exists trusted_pro_apply_min_best_x_30d numeric not null default 0;

comment on column public.dashboard_admin_settings.trusted_pro_apply_min_total_calls is
  'Hidden threshold; do not expose to users. Minimum verified calls before a user can apply for Trusted Pro.';

comment on column public.dashboard_admin_settings.trusted_pro_apply_min_avg_x is
  'Hidden threshold; do not expose to users. Minimum avg X required to apply for Trusted Pro.';

comment on column public.dashboard_admin_settings.trusted_pro_apply_min_win_rate is
  'Hidden threshold; do not expose to users. Minimum win rate (%) required to apply for Trusted Pro.';

comment on column public.dashboard_admin_settings.trusted_pro_apply_min_best_x_30d is
  'Hidden threshold; do not expose to users. Minimum best X (30d) required to apply for Trusted Pro.';

create table if not exists public.trusted_pro_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_discord_id text not null references public.users(discord_id) on delete cascade,
  status text not null default 'pending', -- pending | approved | denied
  application_note text null,

  snapshot_total_calls int not null default 0,
  snapshot_avg_x numeric not null default 0,
  snapshot_win_rate numeric not null default 0,
  snapshot_best_x_30d numeric not null default 0,

  staff_notes text null,
  reviewed_at timestamptz null,
  reviewed_by_discord_id text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trusted_pro_applications_status_created_idx
  on public.trusted_pro_applications (status, created_at desc);

create unique index if not exists trusted_pro_applications_one_pending_per_user
  on public.trusted_pro_applications (applicant_discord_id)
  where status = 'pending';

