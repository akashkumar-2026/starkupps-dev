-- RLS hardening: enable RLS on public catalog tables and lock down writes.
--
-- Audit finding S2: menu_* / modifier_* / outlet_* catalog tables had RLS
-- disabled entirely. Because the storefront ships the Supabase anon key, any
-- visitor could read AND write (INSERT/UPDATE/DELETE) these tables directly
-- through PostgREST, bypassing the admin gateway.
--
-- Audit finding S3: the public image buckets granted INSERT/UPDATE/DELETE to
-- every `authenticated` Supabase user. With customer signup enabled, any
-- self-registered customer could upload/overwrite/delete bucket objects.
--
-- Target posture:
--   * Public catalog tables: RLS ON, SELECT-only policy for anon/authenticated
--     (required for storefront reads and Realtime postgres_changes RLS checks).
--     No write policies -> service_role (gateway) is the only writer.
--   * Storage: public read (unchanged), writes restricted to service_role.
--
-- Idempotent: safe to re-run. Run with: npx supabase db push --linked

-- ============================================================
-- 1. Catalog tables: enable RLS + public SELECT-only
-- ============================================================
ALTER TABLE public.menu_categories          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_item_variants       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modifier_groups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modifier_options         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_item_modifiers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlets                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlet_hours             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlet_menu_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlet_variant_availability ENABLE ROW LEVEL SECURITY;

-- Public read policies (catalog data is intentionally public). Writes are
-- intentionally absent for anon/authenticated; the gateway writes via
-- service_role, which bypasses RLS.
DROP POLICY IF EXISTS "menu_categories_public_read" ON public.menu_categories;
CREATE POLICY "menu_categories_public_read" ON public.menu_categories
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "menu_items_public_read" ON public.menu_items;
CREATE POLICY "menu_items_public_read" ON public.menu_items
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "menu_item_variants_public_read" ON public.menu_item_variants;
CREATE POLICY "menu_item_variants_public_read" ON public.menu_item_variants
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "modifier_groups_public_read" ON public.modifier_groups;
CREATE POLICY "modifier_groups_public_read" ON public.modifier_groups
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "modifier_options_public_read" ON public.modifier_options;
CREATE POLICY "modifier_options_public_read" ON public.modifier_options
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "menu_item_modifiers_public_read" ON public.menu_item_modifiers;
CREATE POLICY "menu_item_modifiers_public_read" ON public.menu_item_modifiers
  FOR SELECT TO anon, authenticated USING (true);

-- Outlets: public read so the storefront can list/select outlets and receive
-- Realtime outlet changes. Business contact/location info is customer-facing.
DROP POLICY IF EXISTS "outlets_public_read" ON public.outlets;
CREATE POLICY "outlets_public_read" ON public.outlets
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "outlet_hours_public_read" ON public.outlet_hours;
CREATE POLICY "outlet_hours_public_read" ON public.outlet_hours
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "outlet_menu_availability_public_read" ON public.outlet_menu_availability;
CREATE POLICY "outlet_menu_availability_public_read" ON public.outlet_menu_availability
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "outlet_variant_availability_public_read" ON public.outlet_variant_availability;
CREATE POLICY "outlet_variant_availability_public_read" ON public.outlet_variant_availability
  FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- 2. Storage: remove broad authenticated write policies.
--    Keep public SELECT and service_role ALL (server-side uploads only).
-- ============================================================
DO $$
BEGIN
  -- starkupps bucket
  DROP POLICY IF EXISTS "starkupps_authenticated_insert" ON storage.objects;
  DROP POLICY IF EXISTS "starkupps_authenticated_update" ON storage.objects;
  DROP POLICY IF EXISTS "starkupps_authenticated_delete" ON storage.objects;
  -- product-images bucket
  DROP POLICY IF EXISTS "product_images_authenticated_insert" ON storage.objects;
  DROP POLICY IF EXISTS "product_images_authenticated_update" ON storage.objects;
  DROP POLICY IF EXISTS "product_images_authenticated_delete" ON storage.objects;
  -- category-images bucket
  DROP POLICY IF EXISTS "category_images_authenticated_insert" ON storage.objects;
  DROP POLICY IF EXISTS "category_images_authenticated_update" ON storage.objects;
  DROP POLICY IF EXISTS "category_images_authenticated_delete" ON storage.objects;
END $$;

-- Re-assert public read + service_role write for the image buckets (idempotent).
DO $$
BEGIN
  BEGIN
    CREATE POLICY "product_images_public_read" ON storage.objects
      FOR SELECT USING (bucket_id = 'product-images');
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    CREATE POLICY "product_images_service_all" ON storage.objects
      FOR ALL TO service_role
      USING (bucket_id = 'product-images') WITH CHECK (bucket_id = 'product-images');
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  BEGIN
    CREATE POLICY "category_images_public_read" ON storage.objects
      FOR SELECT USING (bucket_id = 'category-images');
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    CREATE POLICY "category_images_service_all" ON storage.objects
      FOR ALL TO service_role
      USING (bucket_id = 'category-images') WITH CHECK (bucket_id = 'category-images');
  EXCEPTION WHEN duplicate_object THEN NULL; END;

  BEGIN
    CREATE POLICY "starkupps_public_read" ON storage.objects
      FOR SELECT USING (bucket_id = 'starkupps');
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    CREATE POLICY "starkupps_service_all" ON storage.objects
      FOR ALL TO service_role
      USING (bucket_id = 'starkupps') WITH CHECK (bucket_id = 'starkupps');
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
