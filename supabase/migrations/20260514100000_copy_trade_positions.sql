-- Open positions after a successful buy; sell milestones run against executor wallet balances.

create table if not exists public.copy_trade_positions (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references public.copy_trade_intents (id) on delete cascade,
  strategy_id uuid not null references public.copy_trade_strategies (id) on delete cascade,
  discord_user_id text not null,
  mint text not null,
  entry_buy_lamports bigint not null,
  entry_token_out_raw text not null,
  sell_rules_snapshot jsonb not null,
  next_rule_index int not null default 0,
  status text not null default 'open'
    check (status in ('open', 'closed')),
  detail jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint copy_trade_positions_intent_unique unique (intent_id)
);

create index if not exists copy_trade_positions_open_idx
  on public.copy_trade_positions (created_at asc)
  where status = 'open';

create index if not exists copy_trade_positions_strategy_idx
  on public.copy_trade_positions (strategy_id);

comment on table public.copy_trade_positions is
  'One row per completed buy intent; cron evaluates sell_rules vs Jupiter-implied multiple and executes token→SOL sells.';
