-- Pinned call on user profiles

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pinned_call_id UUID;

