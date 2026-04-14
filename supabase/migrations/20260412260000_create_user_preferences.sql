-- Per-user activity / notification preferences (Discord id)

CREATE TABLE IF NOT EXISTS public.user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT UNIQUE NOT NULL,
  own_calls BOOLEAN DEFAULT TRUE,
  include_following BOOLEAN DEFAULT TRUE,
  include_global BOOLEAN DEFAULT FALSE,
  min_multiple NUMERIC DEFAULT 2,
  created_at TIMESTAMP DEFAULT NOW()
);
