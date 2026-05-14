-- Recovery codes, optional trust window on session proofs, verify throttling

ALTER TABLE public.totp_session_proofs
  ADD COLUMN IF NOT EXISTS trust_expires_at_ms bigint;

COMMENT ON COLUMN public.totp_session_proofs.trust_expires_at_ms IS 'When set, consuming this proof sets JWT totpTrustExpiresAt so the user skips TOTP until this unix ms (e.g. 30d remember browser).';

CREATE TABLE IF NOT EXISTS public.totp_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_id text NOT NULL,
  code_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS totp_recovery_codes_discord_unused_idx
  ON public.totp_recovery_codes (discord_id)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS public.totp_verify_throttle (
  discord_id text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now()
);
