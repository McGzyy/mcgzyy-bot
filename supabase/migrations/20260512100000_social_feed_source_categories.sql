-- Structured categories for social feed sources + submissions (slug + optional "other" text).
-- Slug validity is enforced in DB; "other" detail length is enforced in the app.

alter table public.social_feed_source_submissions
  add column if not exists category_other text;

-- Normalize legacy free-text `category` into slug + category_other.
update public.social_feed_source_submissions
set
  category_other = case
    when lower(trim(coalesce(category, ''))) in ('kol', 'protocol', 'news', 'trader', 'media', 'other')
    then null
    else nullif(trim(category), '')
  end,
  category = case
    when lower(trim(coalesce(category, ''))) in ('kol', 'protocol', 'news', 'trader', 'media', 'other')
    then lower(trim(category))
    else 'other'
  end
where category is not null;

update public.social_feed_source_submissions
set category_other = coalesce(nullif(trim(category_other), ''), 'Unspecified')
where lower(trim(coalesce(category, ''))) = 'other'
  and (category_other is null or trim(category_other) = '');

alter table public.social_feed_source_submissions
  alter column category set default 'other';

update public.social_feed_source_submissions
set category = 'other', category_other = 'Unspecified'
where category is null or trim(category) = '';

alter table public.social_feed_source_submissions
  alter column category set not null;

alter table public.social_feed_source_submissions
  drop constraint if exists social_feed_source_submissions_category_slug_check;

alter table public.social_feed_source_submissions
  add constraint social_feed_source_submissions_category_slug_check
  check (category in ('kol', 'protocol', 'news', 'trader', 'media', 'other'));

-- Live monitored sources
alter table public.social_feed_sources
  add column if not exists category text;

alter table public.social_feed_sources
  add column if not exists category_other text;

update public.social_feed_sources
set category = 'other', category_other = 'Legacy monitored account'
where category is null;

alter table public.social_feed_sources
  alter column category set not null;

alter table public.social_feed_sources
  alter column category set default 'other';

alter table public.social_feed_sources
  drop constraint if exists social_feed_sources_category_check;

alter table public.social_feed_sources
  add constraint social_feed_sources_category_check
  check (category in ('kol', 'protocol', 'news', 'trader', 'media', 'other'));

update public.social_feed_sources
set category_other = 'Legacy monitored account'
where lower(trim(coalesce(category, ''))) = 'other'
  and (category_other is null or trim(category_other) = '');

create index if not exists social_feed_sources_category_idx
  on public.social_feed_sources (category)
  where active = true;
