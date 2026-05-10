-- Copy trading (phase 1): user strategies + signal ledger + per-user intents when a bot call lands.
-- On-chain vault, deposits, and swap execution are planned as a later phase on top of this ledger.

create table if not exists public.copy_trade_strategies (
  id uuid primary key default gen_random_uuid(),
  discord_user_id text not null,
  enabled boolean not null default false,
  mirror_bot_calls_only boolean not null default true,
  max_buy_lamports bigint not null default 0,
  max_slippage_bps int not null default 800,
  min_call_mcap_usd double precision,
  min_bot_win_rate_2x_pct double precision,
  sell_rules jsonb not null default '[{"multiple": 2, "sell_fraction": 1}]'::jsonb,
  fee_on_sell_bps int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint copy_trade_strategies_discord_user_unique unique (discord_user_id),
  constraint copy_trade_strategies_slippage_chk check (max_slippage_bps >= 0 and max_slippage_bps <= 5000),
  constraint copy_trade_strategies_fee_chk check (fee_on_sell_bps >= 0 and fee_on_sell_bps <= 2500),
  constraint copy_trade_strategies_buy_chk check (max_buy_lamports >= 0)
);

create index if not exists copy_trade_strategies_enabled_idx
  on public.copy_trade_strategies (enabled)
  where enabled = true;

comment on table public.copy_trade_strategies is
  'Per-Discord-user copy settings for reacting to mirrored bot calls. Phase 1 records intents only.';

create table if not exists public.copy_trade_signals (
  id uuid primary key default gen_random_uuid(),
  call_performance_id uuid not null references public.call_performance (id) on delete cascade,
  call_ca text not null,
  source text not null,
  snapshot jsonb,
  created_at timestamptz not null default now(),
  constraint copy_trade_signals_call_perf_unique unique (call_performance_id)
);

create index if not exists copy_trade_signals_created_idx
  on public.copy_trade_signals (created_at desc);

create table if not exists public.copy_trade_intents (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.copy_trade_strategies (id) on delete cascade,
  signal_id uuid not null references public.copy_trade_signals (id) on delete cascade,
  discord_user_id text not null,
  status text not null default 'queued'
    check (status in ('queued', 'skipped', 'processing', 'completed', 'failed')),
  detail jsonb,
  created_at timestamptz not null default now(),
  constraint copy_trade_intents_strategy_signal_unique unique (strategy_id, signal_id)
);

create index if not exists copy_trade_intents_user_created_idx
  on public.copy_trade_intents (discord_user_id, created_at desc);

create index if not exists copy_trade_intents_signal_idx
  on public.copy_trade_intents (signal_id);

comment on table public.copy_trade_signals is
  'One row per call_performance bot signal ingested for copy routing.';

comment on table public.copy_trade_intents is
  'Per-strategy reaction to a signal (queued when filters pass, skipped otherwise).';
