-- Dedupe Stripe subscription renewal rows in membership_events (one row per paid invoice).
alter table public.membership_events
  add column if not exists stripe_invoice_id text;

create unique index if not exists membership_events_stripe_invoice_uidx
  on public.membership_events (stripe_invoice_id)
  where stripe_invoice_id is not null;

comment on column public.membership_events.stripe_invoice_id is 'Stripe Invoice id (in_…) for renewal audit rows; unique when set.';
