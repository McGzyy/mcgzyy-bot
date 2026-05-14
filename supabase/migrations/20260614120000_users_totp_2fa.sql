-- Optional app TOTP (authenticator) after Discord OAuth. Secrets stored encrypted (app-side); see TOTP_ENCRYPTION_KEY.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_secret_enc text,
  ADD COLUMN IF NOT EXISTS totp_pending_enc text;

COMMENT ON COLUMN public.users.totp_secret_enc IS 'AES-256-GCM payload for active TOTP secret (base32), when totp_enabled.';
COMMENT ON COLUMN public.users.totp_pending_enc IS 'Encrypted pending secret during enrollment before totp_enabled.';

CREATE TABLE IF NOT EXISTS public.totp_session_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS totp_session_proofs_discord_created_idx
  ON public.totp_session_proofs (discord_id, created_at DESC);
