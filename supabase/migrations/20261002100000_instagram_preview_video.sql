-- Optional short, muted Reel preview clips for the storefront feed.
ALTER TABLE public.instagram_posts
  ADD COLUMN IF NOT EXISTS "previewVideoUrl" text;

COMMENT ON COLUMN public.instagram_posts."previewVideoUrl" IS
  'Optional uploaded MP4 teaser. The storefront plays at most 2.5 seconds, then keeps the cover visible; clicking opens the Instagram permalink.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'instagram-previews',
  'instagram-previews',
  true,
  5242880,
  ARRAY['video/mp4']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS instagram_previews_public_read ON storage.objects;
CREATE POLICY instagram_previews_public_read ON storage.objects
  FOR SELECT USING (bucket_id = 'instagram-previews');

DROP POLICY IF EXISTS instagram_previews_service_all ON storage.objects;
CREATE POLICY instagram_previews_service_all ON storage.objects
  FOR ALL
  USING (bucket_id = 'instagram-previews' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'instagram-previews' AND auth.role() = 'service_role');
