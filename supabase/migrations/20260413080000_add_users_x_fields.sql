-- X (Twitter) profile fields

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS x_handle TEXT;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS x_verified BOOLEAN NOT NULL DEFAULT FALSE;

