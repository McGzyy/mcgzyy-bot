-- Backfill copy_trade_positions for completed buys that predate position inserts (idempotent).

insert into public.copy_trade_positions (
  intent_id,
  strategy_id,
  discord_user_id,
  mint,
  entry_buy_lamports,
  entry_token_out_raw,
  sell_rules_snapshot,
  next_rule_index,
  status,
  detail,
  created_at,
  updated_at
)
select
  i.id,
  i.strategy_id,
  i.discord_user_id,
  trim(s.call_ca),
  coalesce(i.buy_input_lamports, 0)::bigint,
  coalesce(nullif(trim(i.detail->>'out_amount'), ''), '0'),
  st.sell_rules,
  0,
  'open',
  jsonb_build_object('backfilled', true),
  coalesce(i.completed_at, i.updated_at, now()),
  now()
from public.copy_trade_intents i
inner join public.copy_trade_signals s on s.id = i.signal_id
inner join public.copy_trade_strategies st on st.id = i.strategy_id
where i.status = 'completed'
  and not exists (select 1 from public.copy_trade_positions p where p.intent_id = i.id)
  and trim(coalesce(s.call_ca, '')) <> ''
  and coalesce(i.buy_input_lamports, 0) > 0
on conflict (intent_id) do nothing;
