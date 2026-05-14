-- Aggregates for admin Outside X monitors (per source_id).

create or replace view public.outside_x_source_call_stats as
select
  oc.source_id,
  count(*) filter (where oc.call_role = 'primary')::bigint as primary_call_count,
  avg(oc.trust_max_ath_multiple) filter (
    where oc.call_role = 'primary' and oc.trust_max_ath_multiple > 0
  ) as avg_peak_multiple
from public.outside_calls oc
group by oc.source_id;

comment on view public.outside_x_source_call_stats is
  'Per outside_x_sources: count of primary outside_calls rows, and mean peak ATH multiple (trust_max_ath_multiple) over primaries that have moved above 0.';

grant select on public.outside_x_source_call_stats to service_role;
