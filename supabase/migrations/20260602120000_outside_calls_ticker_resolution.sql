-- Optional metadata when outside ingest resolves a mint from a $TICKER (see utils/outsideTickerResolve.js).

alter table public.outside_calls
  add column if not exists signal_ticker text,
  add column if not exists mint_resolution text;

alter table public.outside_calls
  drop constraint if exists outside_calls_mint_resolution_chk;

alter table public.outside_calls
  add constraint outside_calls_mint_resolution_chk
  check (
    mint_resolution is null
    or mint_resolution in ('ca_in_post', 'curated_map', 'dex_search')
  );

comment on column public.outside_calls.signal_ticker is
  'Normalized cashtag (e.g. JUP) from the X post when mint came from the ticker resolution path; null for pure CA extracts.';

comment on column public.outside_calls.mint_resolution is
  'ca_in_post = base58 mint in tweet; curated_map = staff/static symbol→mint map; dex_search = Dexscreener search heuristic.';
