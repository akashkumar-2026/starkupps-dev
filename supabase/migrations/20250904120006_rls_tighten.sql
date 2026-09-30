-- Phase 10: Tighten RLS — deny anon, keep service_role bypass
-- Rationale: All app queries use getSupabaseAdmin() (service_role, bypasses RLS).
-- Permissive FOR ALL USING (true) previously allowed anon key to read/write via PostgREST directly.
-- This migration drops permissive policies, leaving RLS enabled with NO anon/authenticated policies
-- → anon → 0 rows (deny), service_role → bypass → full access via app-side outletFilter/assertOutletAccess.
-- Future: when Supabase Auth is adopted, replace with auth.uid() + is_member_of_outlet(auth.uid()::int, outletId) policies.

-- Drop permissive policies (if exist)
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'customers','orders','order_items','payments','refunds',
    'inventory_items','cash_drawers','cash_movements','pos_terminals','pos_sessions',
    'staff','outlet_staff','coupons','coupon_redemptions'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_permissive_all ON public.%I', t, t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "users_select_self_or_service" ON public.users;
DROP POLICY IF EXISTS "users_all_service" ON public.users;

-- Re-create minimal deny-by-default: no policies = deny for anon/authenticated
-- Keep users table with no policies (deny anon) — service_role still bypasses for seed/login
-- For catalog tables that should be public-readable (menu), allow anon SELECT only
-- Menu catalog is public: allow anon to read menu_categories/menu_items/menu_item_variants
-- But our publicRouter uses service_role anyway, so we keep anon deny for now and rely on service_role
-- If you need public anon read, uncomment below:
-- CREATE POLICY "menu_categories_public_read" ON public.menu_categories FOR SELECT USING (true);
-- CREATE POLICY "menu_items_public_read" ON public.menu_items FOR SELECT USING (true);
-- CREATE POLICY "menu_item_variants_public_read" ON public.menu_item_variants FOR SELECT USING (true);

-- Ensure storage bucket RLS remains permissive for public read (already in 20250904120004)
-- No change to storage.objects policies

-- Helper to verify: anon should get 0 rows, service_role gets data
-- SELECT * FROM public.orders; -- as anon → 0 rows, as service_role → rows (bypass)
