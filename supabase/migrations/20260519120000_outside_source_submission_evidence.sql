-- Extra fields for community X monitor proposals (recent performance + context).

alter table public.outside_source_submissions
  add column if not exists track_record text,
  add column if not exists extra_context text;

comment on column public.outside_source_submissions.track_record is
  'User-provided examples: recent calls and multiples / performance (staff review).';

comment on column public.outside_source_submissions.extra_context is
  'Optional freeform context for staff (style, focus, caveats).';
