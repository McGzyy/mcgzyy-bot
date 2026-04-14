-- Extend dashboard widget flags (recent_calls, referral_link, referrals); default true.

ALTER TABLE public.user_dashboard_settings
  ALTER COLUMN widgets_enabled SET DEFAULT '{
    "market": true,
    "top_performers": true,
    "rank": true,
    "activity": true,
    "trending": true,
    "notes": false,
    "recent_calls": true,
    "referral_link": true,
    "referrals": true
  }'::jsonb;
