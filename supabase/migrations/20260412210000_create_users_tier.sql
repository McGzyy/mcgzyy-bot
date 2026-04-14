-- User tier (read-only usage for now; no RLS policies required until you enforce access)

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
