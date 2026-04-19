-- Personal dashboard watchlist (Solana mints), not posted to Discord

ALTER TABLE public.user_dashboard_settings
ADD COLUMN IF NOT EXISTS private_watchlist JSONB DEFAULT '[]'::jsonb;
