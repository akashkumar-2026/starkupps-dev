-- Category images bucket: 5 MB, public CDN, mirrors product-images architecture
-- Supports both Upload (storage) and Image URL (external) — imageUrl in menu_categories stores final public URL in both cases.
-- Bucket is public for fast CDN reads (Web/POS/Admin), writes via service_role (admin server).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'category-images',
  'category-images',
  true,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies for category-images (idempotent, mirrors product-images)
DO $$
BEGIN
  BEGIN
    CREATE POLICY "category_images_public_read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'category-images');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    CREATE POLICY "category_images_authenticated_insert"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'category-images' AND auth.role() = 'authenticated');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    CREATE POLICY "category_images_authenticated_update"
      ON storage.objects FOR UPDATE
      USING (bucket_id = 'category-images' AND auth.role() = 'authenticated');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    CREATE POLICY "category_images_authenticated_delete"
      ON storage.objects FOR DELETE
      USING (bucket_id = 'category-images' AND auth.role() = 'authenticated');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    CREATE POLICY "category_images_service_all"
      ON storage.objects FOR ALL
      USING (bucket_id = 'category-images' AND auth.role() = 'service_role')
      WITH CHECK (bucket_id = 'category-images');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- bucket ready — app uses service_role upload via adminRouter storage.uploadCategoryImage / uploadProductImage
