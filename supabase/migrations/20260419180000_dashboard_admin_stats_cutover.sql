-- Stats cutover: call_performance rows before this instant are ignored in leaderboard / profile stats APIs.

alter table public.dashboard_admin_settings
  add column if not exists stats_cutover_at timestamptz;
