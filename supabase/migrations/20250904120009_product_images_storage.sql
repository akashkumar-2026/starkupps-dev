-- Product images bucket: 5 MB, public, scalable and production-grade
-- Supports both direct Image URL (external) and Upload (storage) — imageUrl in menu_items stores the final public URL in both cases.
-- Bucket is public for fast CDN reads (Web/POS), writes are via service_role (admin server) — client never needs storage write RLS.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies for product-images (idempotent)
-- RLS is enabled on storage.objects by default; service_role bypasses RLS, anon gets public read.
DO $$
BEGIN
  BEGIN
    CREATE POLICY "product_images_public_read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'product-images');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    CREATE POLICY "product_images_authenticated_insert"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'product-images' AND auth.role() = 'authenticated');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    CREATE POLICY "product_images_authenticated_update"
      ON storage.objects FOR UPDATE
      USING (bucket_id = 'product-images' AND auth.role() = 'authenticated');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    CREATE POLICY "product_images_authenticated_delete"
      ON storage.objects FOR DELETE
      USING (bucket_id = 'product-images' AND auth.role() = 'authenticated');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- Explicit service_role policy for completeness (service_role bypasses RLS anyway)
  BEGIN
    CREATE POLICY "product_images_service_all"
      ON storage.objects FOR ALL
      USING (bucket_id = 'product-images' AND auth.role() = 'service_role')
      WITH CHECK (bucket_id = 'product-images');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- Ensure product-images bucket is in public read for anon (if RLS tighten later, uncomment)
-- No additional publication needed — storage is not part of supabase_realtime.

-- storage.objects is owned by supabase_storage_admin; the postgres role cannot
-- always alter its comment. Guarded so the migration applies on any project.
DO $$
BEGIN
  COMMENT ON TABLE storage.objects IS 'Stores product-images and starkupps buckets; product-images is 5MB limit, public CDN';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'skipping comment on storage.objects (not owner)';
END $$;
