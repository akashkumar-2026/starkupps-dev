-- ============================================================================
-- Storage RLS repair + site_settings + realtime publication + query indexes
--
-- Three independent problems, one migration.
--
-- 1. STORAGE WRITE HOLE (Critical)
--    `product_images_service_all` and `category_images_service_all` carry a
--    service_role check in USING but NOT in WITH CHECK. Postgres evaluates
--    INSERT/UPDATE against WITH CHECK only, so the role guard was never applied
--    to writes. Verified against the live project before this migration:
--      POST /storage/v1/object/product-images/hack-test.png   -> HTTP 200
--      POST /storage/v1/object/category-images/hack.png      -> HTTP 200
--    (the `starkupps` bucket, whose policy does gate on service_role, correctly
--    returned 403). Both policies are dropped and recreated with the check in
--    both places, and the role list narrowed to service_role rather than public.
--
-- 2. site_settings
--    Every business fact on the storefront — phone, WhatsApp, address, opening
--    hours, FSSAI licence, hero copy, the stats strip, the trust claims and the
--    reviews — was a string literal in the React bundle. This is the single-row
--    table the admin panel edits and the public site reads. Anon gets SELECT so
--    the storefront can read it without the gateway; everything else is
--    service_role only (the admin gateway holds the service role).
--
-- 3. REPLICA IDENTITY + PUBLICATION + INDEXES
--    `orders` and `deliveries` have REPLICA IDENTITY DEFAULT, so a DELETE
--    payload carries no columns and the relay in server/realtime.ts cannot
--    report which row vanished. FULL fixes that. The publication gains
--    `site_settings`. Indexes cover the filters and sorts the gateway actually
--    uses on these tables.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Storage write policies
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS product_images_service_all ON storage.objects;
DROP POLICY IF EXISTS category_images_service_all ON storage.objects;

-- service_role is the only writer. The gateway uploads with the service key.
CREATE POLICY product_images_service_all ON storage.objects
  FOR ALL TO service_role
  USING      (bucket_id = 'product-images' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'product-images' AND auth.role() = 'service_role');

CREATE POLICY category_images_service_all ON storage.objects
  FOR ALL TO service_role
  USING      (bucket_id = 'category-images' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'category-images' AND auth.role() = 'service_role');

-- Reads stay open: these buckets back menu/category images on the public site,
-- and the images themselves are not sensitive.
-- (starkupps_public_read and the two *_public_read policies already exist and
-- are correct, so they are left alone.)

-- Belt and braces: revoke anon/authenticated write grants on the object table.
-- RLS is the real control, but revoking the privilege means a policy mistake
-- cannot be reached at all.
REVOKE INSERT, UPDATE, DELETE ON storage.objects FROM anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. site_settings
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.site_settings (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Brand / contact
  "brandName"     text NOT NULL DEFAULT 'StarKupps',
  "tagline"       text NOT NULL DEFAULT '',
  "phoneDigits"   text NOT NULL DEFAULT '',
  "whatsappNumber" text NOT NULL DEFAULT '',
  "address"       text NOT NULL DEFAULT '',
  "addressDetail" text NOT NULL DEFAULT '',
  "mapsQuery"     text NOT NULL DEFAULT '',
  "latitude"      numeric,
  "longitude"     numeric,
  -- Hours
  "hoursSummary"  text NOT NULL DEFAULT '',
  "hoursShort"    text NOT NULL DEFAULT '',
  "hoursNote"     text NOT NULL DEFAULT '',
  -- Compliance
  "fssaiLicense"  text NOT NULL DEFAULT '',
  -- Hero
  "heroHeading"   text NOT NULL DEFAULT '',
  "heroSubheading" text NOT NULL DEFAULT '',
  "heroBadge"     text NOT NULL DEFAULT '',
  "heroCtaLabel"  text NOT NULL DEFAULT '',
  "openBadge"     text NOT NULL DEFAULT '',
  -- Stats strip (all four are editable text: the cafe owner decides what to
  -- claim, and a claim with no data behind it must not be invented by code)
  "statRatingLabel"  text NOT NULL DEFAULT '',
  "statOrdersLabel"  text NOT NULL DEFAULT '',
  "statPickupLabel"  text NOT NULL DEFAULT '',
  -- Trust section
  "trustHeading"     text NOT NULL DEFAULT '',
  "trustClaim1"      text NOT NULL DEFAULT '',
  "trustClaim2"      text NOT NULL DEFAULT '',
  "trustClaim3"      text NOT NULL DEFAULT '',
  "trustPickupStat"  text NOT NULL DEFAULT '',
  "trustPickupCaption" text NOT NULL DEFAULT '',
  "trustPremadeStat"  text NOT NULL DEFAULT '',
  "trustPremadeCaption" text NOT NULL DEFAULT '',
  -- Gallery
  "galleryHeading"   text NOT NULL DEFAULT '',
  "galleryBody"      text NOT NULL DEFAULT '',
  "galleryImages"    jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Menu section
  "menuHeading"      text NOT NULL DEFAULT '',
  "menuEmptyMessage" text NOT NULL DEFAULT '',
  -- SEO
  "metaTitle"       text NOT NULL DEFAULT '',
  "metaDescription" text NOT NULL DEFAULT '',
  "metaOgDescription" text NOT NULL DEFAULT '',
  -- Quoted: every other table in this schema uses quoted camelCase columns, and
  -- an unquoted identifier folds to `updatedat`, which the typed client would
  -- then select as the wrong name.
  "updatedAt"     timestamp without time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.site_settings IS
  'Single row (id = 1) of editable storefront business facts. Managed from Admin > Settings > Storefront. Read by the public site.';

-- The row must exist for an anon read to return content instead of an empty
-- object. Every column has a DEFAULT and no NOT NULL beyond the defaults, so a
-- blank row is valid — the storefront shows a "not configured yet" state rather
-- than inventing values.
INSERT INTO public.site_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS site_settings_public_read ON public.site_settings;

-- Public SELECT is required: starkupps-web ships the anon key and must render
-- contact details, hours and hero copy without a gateway round-trip per field.
-- The payload is cafe contact information that is already printed on the
-- storefront; there is nothing here a customer may not see.
CREATE POLICY site_settings_public_read ON public.site_settings
  FOR SELECT TO anon, authenticated
  USING (true);

-- Writes: service_role only. No INSERT/UPDATE/DELETE policy for anon or
-- authenticated means both are denied by default.
REVOKE INSERT, UPDATE, DELETE ON public.site_settings FROM anon, authenticated;

-- updatedAt trigger, matching the convention used by every other table.
CREATE OR REPLACE FUNCTION public.touch_site_settings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_settings_touch_updated_at ON public.site_settings;
CREATE TRIGGER site_settings_touch_updated_at
  BEFORE UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_site_settings_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Realtime: replica identity + publication
-- ────────────────────────────────────────────────────────────────────────────

-- DEFAULT carries no old-row columns, so a DELETE arrives with an id and
-- nothing else. FULL makes the relay able to report the payload.
ALTER TABLE public.orders      REPLICA IDENTITY FULL;
ALTER TABLE public.deliveries  REPLICA IDENTITY FULL;
ALTER TABLE public.site_settings REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'site_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.site_settings;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Indexes for filters, sorts and joins actually used by the gateway
-- ────────────────────────────────────────────────────────────────────────────

-- public.menu.list orders items by category then name after fetching them all.
CREATE INDEX IF NOT EXISTS idx_menu_items_available_category
  ON public.menu_items ("categoryId", "available");

CREATE INDEX IF NOT EXISTS idx_menu_categories_sort
  ON public.menu_categories ("sortOrder", "id");

-- public.instagram filters isActive then orders sortOrder.
CREATE INDEX IF NOT EXISTS idx_instagram_posts_active_sort
  ON public.instagram_posts ("isActive", "sortOrder");

-- Admin dashboard and the orders queue both filter by status over a date range.
CREATE INDEX IF NOT EXISTS idx_orders_status_created
  ON public.orders (status, "createdAt" DESC);

-- Keyset pagination on the orders list sorts by (createdAt DESC, id DESC).
CREATE INDEX IF NOT EXISTS idx_orders_created_id
  ON public.orders ("createdAt" DESC, id DESC);

-- Menu list keyset pagination.
CREATE INDEX IF NOT EXISTS idx_menu_items_category_id
  ON public.menu_items ("categoryId", id);

-- Public menu join keys.
CREATE INDEX IF NOT EXISTS idx_menu_item_variants_item_sort
  ON public.menu_item_variants ("menuItemId", "sortOrder");

CREATE INDEX IF NOT EXISTS idx_outlet_variant_availability_outlet
  ON public.outlet_variant_availability ("outletId");

-- Outlet-scoped availability lookups on the public menu path.
CREATE INDEX IF NOT EXISTS idx_outlet_menu_availability_outlet_item
  ON public.outlet_menu_availability ("outletId", "menuItemId");

-- Modifier groups attached to a menu item.
CREATE INDEX IF NOT EXISTS idx_menu_item_modifiers_item
  ON public.menu_item_modifiers ("menuItemId");

-- Customer-facing order lookup by order number (status tracker).
CREATE INDEX IF NOT EXISTS idx_orders_status_updated
  ON public.orders (status, "updatedAt" DESC);

-- Public outlets list orders by code.
CREATE INDEX IF NOT EXISTS idx_outlets_status_code
  ON public.outlets (status, code);