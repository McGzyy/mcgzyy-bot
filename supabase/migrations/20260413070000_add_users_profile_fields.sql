-- User profile fields

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS bio TEXT;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS banner_url TEXT;

