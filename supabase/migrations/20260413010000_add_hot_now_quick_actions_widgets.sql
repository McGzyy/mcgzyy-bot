-- Add hot_now and quick_actions to widgets_enabled default (both true).

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
    "referrals": true,
    "hot_now": true,
    "quick_actions": true
  }'::jsonb;
