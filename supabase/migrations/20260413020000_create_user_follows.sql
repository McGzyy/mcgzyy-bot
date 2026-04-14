-- Who follows whom (Discord IDs as text)

CREATE TABLE IF NOT EXISTS public.user_follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id TEXT NOT NULL,
  following_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT user_follows_follower_following_unique UNIQUE (follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS user_follows_follower_id_idx
  ON public.user_follows (follower_id);

CREATE INDEX IF NOT EXISTS user_follows_following_id_idx
  ON public.user_follows (following_id);
