-- Banner "crop" controls: store focal point for object-position (0..100).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS banner_crop_x SMALLINT;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS banner_crop_y SMALLINT;

COMMENT ON COLUMN public.users.banner_crop_x IS 'Banner focal X position (percent 0..100). Used by dashboard to set CSS object-position.';
COMMENT ON COLUMN public.users.banner_crop_y IS 'Banner focal Y position (percent 0..100). Used by dashboard to set CSS object-position.';

