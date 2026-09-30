-- Instagram feed section for the public storefront (starkupps-web).
--
-- Context: the marketing team pastes Instagram post/reel URLs into the Admin
-- panel; the storefront renders them as an auto-scrolling embed marquee between
-- "The space" (gallery) and "Visit". There is deliberately NO Instagram API
-- integration here — nothing in this migration requires a token. "thumbnailUrl"
-- is a reserved column so a later Graph API sync can populate it and let the
-- card renderer swap from iframes to native thumbnails without a schema change.
--
-- Column names are quoted camelCase to match the rest of the schema (see
-- 20250904120000_initial_schema.sql). The Supabase client selects them as
-- `sortOrder` / `isActive` / `updatedAt` / `thumbnailUrl`, so unquoted
-- identifiers would silently fold to lowercase and break every query.
--
-- RLS posture matches the rest of the project: the storefront ships the anon
-- key to the browser, so these tables are deny-by-default and only the admin
-- gateway (service_role, BYPASSRLS) touches them. The public read is served by
-- the gateway (`/api/public/instagram`), not by PostgREST.
--
-- Idempotent: safe to re-run.

-- ============================================================
-- 1. instagram_posts
-- ============================================================
CREATE TABLE IF NOT EXISTS public.instagram_posts (
  "id"           integer     PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "url"          text        NOT NULL,
  "shortcode"    text        NOT NULL,
  "type"         text        NOT NULL DEFAULT 'post' CHECK ("type" IN ('post', 'reel')),
  "caption"      text,
  -- Reserved for a future Instagram Graph API sync. When set, the card renderer
  -- can use a native <img> instead of an embed iframe. Never required.
  "thumbnailUrl" text,
  "sortOrder"    integer     NOT NULL DEFAULT 0,
  "isActive"     boolean     NOT NULL DEFAULT true,
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "updatedAt"    timestamptz NOT NULL DEFAULT now()
);

-- One row per Instagram permalink. A unique index (rather than a UNIQUE
-- constraint) keeps this migration re-runnable.
CREATE UNIQUE INDEX IF NOT EXISTS uq_instagram_posts_shortcode
  ON public.instagram_posts ("shortcode");

-- Public read path: filter isActive, then order by sortOrder.
CREATE INDEX IF NOT EXISTS idx_instagram_posts_active_sort
  ON public.instagram_posts ("isActive", "sortOrder");

COMMENT ON TABLE public.instagram_posts IS
  'Instagram permalinks rendered by the storefront Instagram section. Managed from Admin > Instagram.';
COMMENT ON COLUMN public.instagram_posts."url" IS
  'Normalized canonical URL: https://www.instagram.com/{p|reel}/{shortcode}/';
COMMENT ON COLUMN public.instagram_posts."shortcode" IS
  'Instagram shortcode parsed from the permalink. Unique — prevents duplicate posts.';
COMMENT ON COLUMN public.instagram_posts."type" IS
  'post (permalink /p/) or reel (permalink /reel/, /reels/, /tv/ — IGTV is video-only).';
COMMENT ON COLUMN public.instagram_posts."thumbnailUrl" IS
  'Reserved for a future Instagram Graph API sync. When set, the card renderer can use a native <img> instead of an embed iframe. Never required.';
COMMENT ON COLUMN public.instagram_posts."sortOrder" IS
  'Ascending display order in the storefront marquee. Bulk-reordered from the Admin panel.';

-- ============================================================
-- 2. instagram_settings (singleton row)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.instagram_settings (
  "id"                integer     PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "enabled"           boolean     NOT NULL DEFAULT true,
  "eyebrow"           text        NOT NULL DEFAULT 'Follow along',
  "heading"           text        NOT NULL DEFAULT 'Follow the froth',
  "subheading"        text,
  "profileHandle"     text        NOT NULL DEFAULT 'starkupps',
  "profileUrl"        text        NOT NULL DEFAULT 'https://www.instagram.com/starkupps/',
  "followButtonLabel" text        NOT NULL DEFAULT 'Follow',
  "scrollSpeed"       text        NOT NULL DEFAULT 'normal' CHECK ("scrollSpeed" IN ('slow', 'normal', 'fast')),
  "maxItems"          integer     NOT NULL DEFAULT 10 CHECK ("maxItems" BETWEEN 1 AND 30),
  "pauseOnHover"      boolean     NOT NULL DEFAULT true,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.instagram_settings IS
  'Singleton row (id = 1) holding copy + behaviour for the storefront Instagram section.';
COMMENT ON COLUMN public.instagram_settings."scrollSpeed" IS
  'slow | normal | fast. Maps to the marquee animation duration per item.';
COMMENT ON COLUMN public.instagram_settings."maxItems" IS
  'Upper bound on posts returned to the storefront. Caps iframe count for performance.';

-- ============================================================
-- 3. RLS — deny by default (see 20260926040000_rls_remaining_tables.sql)
-- ============================================================
ALTER TABLE public.instagram_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.instagram_posts FROM anon, authenticated;
REVOKE ALL ON TABLE public.instagram_settings FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.instagram_posts_id_seq FROM anon, authenticated;

-- ============================================================
-- 4. updatedAt maintenance (mirrors the pattern used across the schema)
-- ============================================================
CREATE OR REPLACE FUNCTION public.touch_instagram_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS instagram_posts_touch_updated_at ON public.instagram_posts;
CREATE TRIGGER instagram_posts_touch_updated_at
  BEFORE UPDATE ON public.instagram_posts
  FOR EACH ROW EXECUTE FUNCTION public.touch_instagram_updated_at();

DROP TRIGGER IF EXISTS instagram_settings_touch_updated_at ON public.instagram_settings;
CREATE TRIGGER instagram_settings_touch_updated_at
  BEFORE UPDATE ON public.instagram_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_instagram_updated_at();

-- ============================================================
-- 5. Realtime publication
--
-- The storefront does NOT subscribe to these tables (the section polls on a
-- ~60s window), but the Admin panel benefits from the same <300ms propagation
-- pattern used by the menu. Rows are RLS-denied to anon, so realtime delivers
-- change *events* without exposing data; the gateway re-reads with service_role.
-- Wrapped because the publication may not exist on a bare Postgres instance.
-- ============================================================
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE
      public.instagram_posts,
      public.instagram_settings;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'supabase_realtime publication not present — skipping realtime registration';
END $$;

-- ============================================================
-- 6. Default settings row — only if empty
-- ============================================================
INSERT INTO public.instagram_settings (
  "id", "enabled", "eyebrow", "heading", "subheading",
  "profileHandle", "profileUrl", "followButtonLabel",
  "scrollSpeed", "maxItems", "pauseOnHover"
)
SELECT
  1, true, 'Follow along', 'Follow the froth',
  'New pours, behind-the-bar shots and the occasional reel of the froth machine.',
  'starkupps', 'https://www.instagram.com/starkupps/', 'Follow',
  'normal', 10, true
WHERE NOT EXISTS (SELECT 1 FROM public.instagram_settings);

-- ============================================================
-- 7. Sample posts — clearly marked placeholders
--
-- These shortcodes are deliberately NOT real Instagram permalinks, so each card
-- renders Instagram's "content unavailable" frame until an owner replaces it
-- with a real link from Admin > Instagram. Delete these four rows once the first
-- real posts are added.
-- ============================================================
INSERT INTO public.instagram_posts ("url", "shortcode", "type", "caption", "sortOrder", "isActive")
SELECT
  'https://www.instagram.com/p/SAMPLEcold01/',
  'SAMPLEcold01',
  'post',
  'SAMPLE — replace with a real permalink',
  10,
  true
WHERE NOT EXISTS (SELECT 1 FROM public.instagram_posts WHERE "shortcode" = 'SAMPLEcold01');

INSERT INTO public.instagram_posts ("url", "shortcode", "type", "caption", "sortOrder", "isActive")
SELECT
  'https://www.instagram.com/reel/SAMPLEreel01/',
  'SAMPLEreel01',
  'reel',
  'SAMPLE — replace with a real reel permalink',
  20,
  true
WHERE NOT EXISTS (SELECT 1 FROM public.instagram_posts WHERE "shortcode" = 'SAMPLEreel01');

INSERT INTO public.instagram_posts ("url", "shortcode", "type", "caption", "sortOrder", "isActive")
SELECT
  'https://www.instagram.com/p/SAMPLEpizza01/',
  'SAMPLEpizza01',
  'post',
  'SAMPLE — replace with a real permalink',
  30,
  true
WHERE NOT EXISTS (SELECT 1 FROM public.instagram_posts WHERE "shortcode" = 'SAMPLEpizza01');

INSERT INTO public.instagram_posts ("url", "shortcode", "type", "caption", "sortOrder", "isActive")
SELECT
  'https://www.instagram.com/reel/SAMPLEgrill01/',
  'SAMPLEgrill01',
  'reel',
  'SAMPLE — replace with a real reel permalink',
  40,
  true
WHERE NOT EXISTS (SELECT 1 FROM public.instagram_posts WHERE "shortcode" = 'SAMPLEgrill01');
