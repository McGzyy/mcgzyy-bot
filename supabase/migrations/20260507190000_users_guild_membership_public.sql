-- Persist Discord guild membership for public visibility + leaderboard eligibility.
-- Updated when users authenticate (NextAuth JWT guild refresh). Left/kicked → false; rejoin → true.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS guild_member_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS guild_membership_checked_at timestamptz;

COMMENT ON COLUMN public.users.guild_member_active IS
  'When false, public profile is hidden and user is excluded from leaderboards/trophies until they rejoin Discord.';

COMMENT ON COLUMN public.users.guild_membership_checked_at IS
  'Last time guild membership was synced from Discord (dashboard bot token).';

CREATE INDEX IF NOT EXISTS users_guild_member_active_idx
  ON public.users (guild_member_active)
  WHERE guild_member_active = false;
