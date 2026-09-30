-- Realtime: complete coverage for web menu sync (admin → web <300ms)
-- web's usePublicMenu multiplexes these tables in a single channel (subscribeMenu).
-- Previously only core tables were in supabase_realtime; category/modifier/outlet tables were missing
-- → admin renaming a category or adding a modifier wouldn't propagate until manual refresh.

-- Ensure REPLICA IDENTITY FULL for tables that lacked it (needed for UPDATE/DELETE payload)
ALTER TABLE public.menu_categories REPLICA IDENTITY FULL;
ALTER TABLE public.modifier_groups REPLICA IDENTITY FULL;
ALTER TABLE public.modifier_options REPLICA IDENTITY FULL;
ALTER TABLE public.menu_item_modifiers REPLICA IDENTITY FULL;
ALTER TABLE public.outlets REPLICA IDENTITY FULL;
ALTER TABLE public.outlet_hours REPLICA IDENTITY FULL;

-- Add to publication (idempotent)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE
      public.menu_categories,
      public.modifier_groups,
      public.modifier_options,
      public.menu_item_modifiers,
      public.outlets,
      public.outlet_hours;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- Note: inventory/promo tables intentionally NOT added — web does not need realtime for them.
-- Anon SELECT: menu catalog tables already have no RLS (always readable + realtime).
-- outlets is also readable via publicApi (service_role) but anon needs SELECT for realtime filtering.
-- Since outlets has no RLS policy yet (RLS not enabled on it per 20250904120003), realtime works.
-- If RLS is later enabled on outlets, add:
--   CREATE POLICY "outlets_public_read" ON public.outlets FOR SELECT USING (status = 'active');
