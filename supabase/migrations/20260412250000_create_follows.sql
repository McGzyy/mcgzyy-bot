-- Discord user follows (follower → following)

CREATE TABLE IF NOT EXISTS public.follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_discord_id TEXT NOT NULL,
  following_discord_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
