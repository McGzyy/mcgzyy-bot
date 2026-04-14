-- Per-user dashboard widget visibility (Discord id)

CREATE TABLE IF NOT EXISTS public.user_dashboard_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id TEXT UNIQUE NOT NULL,
  widgets_enabled JSONB DEFAULT '{
    "market": true,
    "top_performers": true,
    "rank": true,
    "activity": true,
    "trending": true,
    "notes": false
  }'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);
