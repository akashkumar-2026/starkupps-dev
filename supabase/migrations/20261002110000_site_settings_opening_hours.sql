-- Real opening/closing times for the storefront.
--
-- Context: the storefront's open/closed badge was driven by `outlet_hours`, but
-- this deployment has no `outlets` rows, so the badge could never resolve a
-- schedule and silently fell back to the free-text `hoursSummary` prose. Hours
-- therefore live here, on the singleton row that already exists and is already
-- editable in Admin > Settings > Storefront.
--
-- `closedDays` is a comma-separated list of ISO weekday numbers (1 = Monday,
-- 7 = Sunday). Empty means open every day.
--
-- Seeded from the existing prose so the storefront keeps showing the hours the
-- owner had already typed, but as structured values that can be evaluated.

CREATE OR REPLACE FUNCTION public.starkupps_to24h(hh text, mm text, meridiem text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  h int;
  suffix text := upper(coalesce(meridiem, 'AM'));
BEGIN
  IF hh IS NULL OR mm IS NULL THEN
    RETURN NULL;
  END IF;
  h := hh::int % 12;
  IF suffix = 'PM' THEN
    h := h + 12;
  END IF;
  RETURN lpad(h::text, 2, '0') || ':' || mm;
END;
$$;

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS "openTime" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "closeTime" text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "closedDays" text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.site_settings."openTime" IS
  'Daily opening time in 24h HH:mm. Empty means no schedule configured.';
COMMENT ON COLUMN public.site_settings."closeTime" IS
  'Daily closing time in 24h HH:mm. Equal to or earlier than openTime means the shift runs past midnight.';
COMMENT ON COLUMN public.site_settings."closedDays" IS
  'Comma-separated ISO weekday numbers the store is closed (1=Mon .. 7=Sun). Empty = open every day.';

-- Convert the seeded prose (e.g. "10:00 AM – 11:00 PM") into 24h values, once.
-- Only runs while openTime is blank, so a later owner edit is never overwritten.
WITH parsed AS (
  SELECT
    id,
    public.starkupps_to24h(
      (regexp_match("hoursSummary", '([0-9]{1,2}):([0-9]{2})\s*AM'))[1],
      (regexp_match("hoursSummary", '([0-9]{1,2}):([0-9]{2})\s*AM'))[2],
      'AM'
    ) AS open_24,
    public.starkupps_to24h(
      (regexp_match("hoursSummary", '([0-9]{1,2}):([0-9]{2})\s*PM'))[1],
      (regexp_match("hoursSummary", '([0-9]{1,2}):([0-9]{2})\s*PM'))[2],
      'PM'
    ) AS close_24
  FROM public.site_settings
  WHERE id = 1 AND "openTime" = '' AND "hoursSummary" ~ '[0-9]{1,2}:[0-9]{2}'
)
UPDATE public.site_settings s
SET "openTime"  = coalesce(p.open_24,  p.close_24, s."openTime"),
    "closeTime" = coalesce(p.close_24, p.open_24, s."closeTime")
FROM parsed p
WHERE s.id = p.id;