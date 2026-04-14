-- Feature flags per tier (free / pro / elite)

CREATE TABLE IF NOT EXISTS public.feature_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key TEXT NOT NULL UNIQUE,
  free BOOLEAN NOT NULL DEFAULT FALSE,
  pro BOOLEAN NOT NULL DEFAULT FALSE,
  elite BOOLEAN NOT NULL DEFAULT FALSE
);
