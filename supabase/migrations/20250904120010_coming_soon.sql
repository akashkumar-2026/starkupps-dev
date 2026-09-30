-- Coming Soon support for Categories and Products
-- Categories: description, imageUrl, comingSoon
-- Products (menu_items): comingSoon (description/imageUrl already exist)

-- ── menu_categories ──────────────────────────────────────────────
ALTER TABLE public.menu_categories
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "imageUrl" text,
  ADD COLUMN IF NOT EXISTS "comingSoon" boolean NOT NULL DEFAULT false;

-- ── menu_items ───────────────────────────────────────────────────
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS "comingSoon" boolean NOT NULL DEFAULT false;

-- ── Constraints ──────────────────────────────────────────────────
-- description length check (optional, mirrors app validation max 500/1000)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_categories_description_len') THEN
    ALTER TABLE public.menu_categories ADD CONSTRAINT menu_categories_description_len CHECK (char_length("description") <= 500);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_items_coming_soon_bool') THEN
    -- comingSoon is boolean with default false, no extra check needed
    NULL;
  END IF;
END $$;

-- ── Indexes ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "menu_categories_coming_soon_idx" ON public.menu_categories ("comingSoon");
CREATE INDEX IF NOT EXISTS "menu_items_coming_soon_idx" ON public.menu_items ("comingSoon");
-- Composite for listing by category + comingSoon filtering
CREATE INDEX IF NOT EXISTS "menu_items_category_coming_soon_idx" ON public.menu_items ("categoryId", "comingSoon");

-- ── Replica identity already FULL from 20250904120007 (needed for realtime UPDATE/DELETE payload) ──
-- Ensure still FULL (idempotent)
DO $$ BEGIN
  BEGIN
    ALTER TABLE public.menu_categories REPLICA IDENTITY FULL;
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.menu_items REPLICA IDENTITY FULL;
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

-- ── Realtime: ensure both tables are in publication (already added in 20250904120007 for menu_categories; ensure menu_items present) ──
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_items;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_categories;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ── RLS note ─────────────────────────────────────────────────────
-- menu_categories / menu_items currently have no RLS (public readable for catalog).
-- comingSoon does NOT change RLS: items remain readable, just flagged.
-- If RLS is later enabled, add permissive read (anon sees comingSoon=true but blurred):
--   CREATE POLICY "menu_categories_public_read" ON public.menu_categories FOR SELECT USING (true);
--   CREATE POLICY "menu_items_public_read" ON public.menu_items FOR SELECT USING (true);
-- Service role bypasses RLS; admin write remains service_role only (app uses getSupabaseAdmin).

COMMENT ON COLUMN public.menu_categories."description" IS 'Optional category description (max 500 chars)';
COMMENT ON COLUMN public.menu_categories."imageUrl" IS 'Category image URL (uploaded to product-images bucket)';
COMMENT ON COLUMN public.menu_categories."comingSoon" IS 'When true, category and its products are visible but blurred with COMING SOON badge; purchasing blocked server-side';
COMMENT ON COLUMN public.menu_items."comingSoon" IS 'When true, product is visible but blurred with COMING SOON badge; purchasing blocked server-side';
