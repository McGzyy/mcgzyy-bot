-- Expand social feed source categories (12 slugs). Legacy `news` -> `crypto`.

update public.social_feed_sources
set category = 'crypto'
where lower(trim(coalesce(category, ''))) = 'news';

update public.social_feed_source_submissions
set category = 'crypto'
where lower(trim(coalesce(category, ''))) = 'news';

alter table public.social_feed_source_submissions
  drop constraint if exists social_feed_source_submissions_category_slug_check;

alter table public.social_feed_source_submissions
  add constraint social_feed_source_submissions_category_slug_check
  check (
    category in (
      'politics',
      'law',
      'economy',
      'equities',
      'culture',
      'tech',
      'crypto',
      'protocol',
      'trader',
      'kol',
      'media',
      'other'
    )
  );

alter table public.social_feed_sources
  drop constraint if exists social_feed_sources_category_check;

alter table public.social_feed_sources
  add constraint social_feed_sources_category_check
  check (
    category in (
      'politics',
      'law',
      'economy',
      'equities',
      'culture',
      'tech',
      'crypto',
      'protocol',
      'trader',
      'kol',
      'media',
      'other'
    )
  );
