-- Copy trade phase 2: execution audit columns on intents (buy tx + timing + errors).

alter table public.copy_trade_intents
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists buy_signature text,
  add column if not exists buy_input_lamports bigint,
  add column if not exists error_message text,
  add column if not exists executor_wallet text;

comment on column public.copy_trade_intents.started_at is
  'When this intent was claimed for execution (status processing).';
comment on column public.copy_trade_intents.buy_signature is
  'Solana transaction signature for the SOL→token buy when execution succeeds.';
comment on column public.copy_trade_intents.buy_input_lamports is
  'Lamports of wrapped/native SOL allocated as Jupiter swap input for the buy.';
comment on column public.copy_trade_intents.executor_wallet is
  'Public key of the hot wallet that signed the buy (from COPY_TRADE_EXECUTOR_* env).';

create index if not exists copy_trade_intents_queued_created_idx
  on public.copy_trade_intents (created_at asc)
  where status = 'queued';

create index if not exists copy_trade_intents_processing_started_idx
  on public.copy_trade_intents (started_at asc)
  where status = 'processing';
