-- call_performance: caller role (user vs owner, etc.)

ALTER TABLE call_performance
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

UPDATE call_performance
SET role = 'owner'
WHERE discord_id::text = '732566370914664499';
