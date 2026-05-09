-- Optional visibility window for the global announcement (UTC in DB; admin UI uses browser local → ISO).

ALTER TABLE public.dashboard_admin_settings
  ADD COLUMN IF NOT EXISTS announcement_visible_from TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS announcement_visible_until TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.dashboard_admin_settings.announcement_visible_from IS 'If set, announcement is hidden until this instant (UTC).';
COMMENT ON COLUMN public.dashboard_admin_settings.announcement_visible_until IS 'If set, announcement hides when server time is >= this instant (exclusive end).';
