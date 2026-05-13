-- Collapse social feed categories to five slugs (four main tabs + other).
-- Maps any v1 / v2 / v12 values already in the DB.

update public.social_feed_sources
set category = case
  when lower(trim(coalesce(category, '')))
    in ('crypto', 'protocol', 'trader', 'kol', 'media', 'news')
    then 'crypto'
  when lower(trim(coalesce(category, ''))) = 'politics' then 'politics'
  when lower(trim(coalesce(category, ''))) in ('economy', 'law', 'equities') then 'economy'
  when lower(trim(coalesce(category, ''))) in ('culture', 'tech') then 'culture'
  when lower(trim(coalesce(category, ''))) = 'other' then 'other'
  else 'other'
end;

update public.social_feed_source_submissions
set category = case
  when lower(trim(coalesce(category, '')))
    in ('crypto', 'protocol', 'trader', 'kol', 'media', 'news')
    then 'crypto'
  when lower(trim(coalesce(category, ''))) = 'politics' then 'politics'
  when lower(trim(coalesce(category, ''))) in ('economy', 'law', 'equities') then 'economy'
  when lower(trim(coalesce(category, ''))) in ('culture', 'tech') then 'culture'
  when lower(trim(coalesce(category, ''))) = 'other' then 'other'
  else 'other'
end;

alter table public.social_feed_source_submissions
  drop constraint if exists social_feed_source_submissions_category_slug_check;

alter table public.social_feed_source_submissions
  add constraint social_feed_source_submissions_category_slug_check
  check (category in ('crypto', 'politics', 'economy', 'culture', 'other'));

alter table public.social_feed_sources
  drop constraint if exists social_feed_sources_category_check;

alter table public.social_feed_sources
  add constraint social_feed_sources_category_check
  check (category in ('crypto', 'politics', 'economy', 'culture', 'other'));
