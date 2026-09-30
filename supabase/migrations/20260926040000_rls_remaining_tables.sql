-- RLS hardening: enable Row Level Security on the remaining public tables that
-- were created without it.
--
-- Context: the storefront (`starkupps-web`) ships the Supabase anon key to the
-- browser. Supabase's default grants let `anon`/`authenticated` read AND write
-- every public table that does not have RLS enabled. These 27 tables were
-- missed by the earlier catalog lockdown (`20260926000000`), exposing financial
-- (payouts, taxes), configuration (store_settings), inventory BOM
-- (recipes/recipe_components/prepared_items), segmentation/loyalty and the
-- workforce role catalogue to unauthenticated PostgREST clients.
--
-- Target posture: RLS ON, no anon/authenticated policies (deny-by-default),
-- and residual default privileges revoked as defense-in-depth. The admin
-- gateway talks to the database with the service_role key, which has
-- BYPASSRLS, so no gateway behavior changes.
--
-- If a table is later required by the public storefront, add an explicit
-- SELECT-only policy and GRANT SELECT to anon/authenticated at that time.
--
-- Idempotent: safe to re-run.

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'banners',
    'campaigns',
    'content_blocks',
    'customer_feedback',
    'customer_segments',
    'delivery_zones',
    'faqs',
    'inventory_alert_acknowledgements',
    'inventory_categories',
    'loyalty_rules',
    'menu_item_ingredients',
    'menu_variant_ingredients',
    'offers',
    'outlet_closures',
    'payouts',
    'prepared_item_batches',
    'prepared_items',
    'recipe_components',
    'recipes',
    'shift_templates',
    'shifts',
    'store_settings',
    'taxes',
    'testimonials',
    'workforce_permissions',
    'workforce_role_permissions',
    'workforce_roles'
  ]) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
