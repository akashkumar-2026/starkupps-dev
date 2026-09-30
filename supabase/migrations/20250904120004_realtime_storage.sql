-- Realtime + Storage

-- Enable realtime for key tables (add to supabase_realtime publication)
-- supabase_realtime publication exists by default; we add tables with REPLICA IDENTITY FULL where needed for UPDATE/DELETE
ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER TABLE public.order_items REPLICA IDENTITY FULL;
ALTER TABLE public.deliveries REPLICA IDENTITY FULL;
ALTER TABLE public.menu_items REPLICA IDENTITY FULL;
ALTER TABLE public.menu_item_variants REPLICA IDENTITY FULL;
ALTER TABLE public.outlet_menu_availability REPLICA IDENTITY FULL;
ALTER TABLE public.outlet_variant_availability REPLICA IDENTITY FULL;
ALTER TABLE public.pos_sessions REPLICA IDENTITY FULL;

-- Add tables to publication (idempotent)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders, public.order_items, public.deliveries, public.menu_items, public.menu_item_variants, public.outlet_menu_availability, public.outlet_variant_availability, public.pos_sessions;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- Storage: create starkupps bucket (if not exists)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('starkupps', 'starkupps', true, 52428800, ARRAY['image/png','image/jpeg','image/webp','image/gif'])
ON CONFLICT (id) DO NOTHING;

-- Storage policies: authenticated can upload, public can read
-- (requires storage.objects RLS - supabase storage enables RLS by default)
-- Drop existing if re-run
DO $$
BEGIN
  BEGIN
    CREATE POLICY "starkupps_public_read" ON storage.objects FOR SELECT USING (bucket_id = 'starkupps');
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    CREATE POLICY "starkupps_authenticated_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'starkupps' AND auth.role() = 'authenticated');
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    CREATE POLICY "starkupps_authenticated_update" ON storage.objects FOR UPDATE USING (bucket_id = 'starkupps' AND auth.role() = 'authenticated');
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    CREATE POLICY "starkupps_authenticated_delete" ON storage.objects FOR DELETE USING (bucket_id = 'starkupps' AND auth.role() = 'authenticated');
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
