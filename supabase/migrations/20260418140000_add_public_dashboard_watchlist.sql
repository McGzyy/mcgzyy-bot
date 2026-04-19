-- Mints submitted as "public" from the dashboard (also posted via bot !watch)

ALTER TABLE public.user_dashboard_settings
ADD COLUMN IF NOT EXISTS public_dashboard_watchlist JSONB DEFAULT '[]'::jsonb;
