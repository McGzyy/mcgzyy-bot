ALTER TABLE public.call_performance
  ADD COLUMN IF NOT EXISTS token_image_url text;

COMMENT ON COLUMN public.call_performance.token_image_url IS 'Token icon URL at call time (Dex / Gecko), optional.';
