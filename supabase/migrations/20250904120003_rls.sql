-- RLS: enable Row Level Security + helper functions + outlet isolation policies
-- Design: service_role bypasses RLS; anon/authenticated must satisfy policies
-- Initially permissive for migration (all authenticated can read), then tightened per outlet/role

-- Helper: current user outlet membership (staff -> outlet_staff)
CREATE OR REPLACE FUNCTION public.is_member_of_outlet(uid int, oid int)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.outlet_staff WHERE "staffId" = uid AND "outletId" = oid)
         OR EXISTS (SELECT 1 FROM public.staff WHERE id = uid AND "primaryOutletId" = oid)
$$;

-- Helper: check staff has active status
CREATE OR REPLACE FUNCTION public.is_active_staff(uid int)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff WHERE id = uid AND active = true AND status IN ('active','on_leave'))
$$;

-- Enable RLS on sensitive tables (leave catalog tables readable without RLS if desired, but we enable with permissive read)
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'users','staff','outlet_staff','customers','orders','order_items','payments','refunds',
    'inventory_items','inventory_transactions','inventory_batches','cash_drawers','cash_movements',
    'pos_terminals','pos_sessions','deliveries','riders','coupons','coupon_redemptions',
    'attendance_records','leave_requests','staff_schedules','audit_log','expenses','suppliers',
    'purchase_orders','purchase_order_lines','stock_transfers','stock_transfer_items','wastage_records',
    'support_tickets','support_messages','notifications','loyalty_transactions'
  ]) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Policies: For now create permissive policies for authenticated + service_role bypass
-- Service role bypasses RLS automatically; we create policies that allow authenticated to read/write their outlet data
-- To avoid locking out migration/seed, we start with FOR ALL USING (true) for authenticated, then tighten later.
-- This migration establishes the structure; Phase 10 will tighten to outlet isolation.

-- Example: users can read self + admin can read all
DROP POLICY IF EXISTS "users_select_self_or_service" ON public.users;
CREATE POLICY "users_select_self_or_service" ON public.users
  FOR SELECT USING (true); -- tighten later to auth.uid() mapping; for now allow service and migration

DROP POLICY IF EXISTS "users_all_service" ON public.users;
CREATE POLICY "users_all_service" ON public.users
  FOR ALL USING (true) WITH CHECK (true);

-- Generic permissive for other tables (to be replaced with outlet isolation in follow-up)
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'customers','orders','order_items','payments','refunds',
    'inventory_items','cash_drawers','cash_movements','pos_terminals','pos_sessions',
    'staff','outlet_staff','coupons','coupon_redemptions'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_permissive_all ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_permissive_all ON public.%I FOR ALL USING (true) WITH CHECK (true)', t, t);
  END LOOP;
END $$;

-- Note: outlet isolation enforcement is currently app-side (getOutletScope/assertOutletAccess).
-- After Phase 7-8 app migration to supabase-js server client, replace these permissive policies with:
--   CREATE POLICY outlet_isolation ON public.orders FOR SELECT USING (
--     public.is_member_of_outlet(current_setting(''app.current_user_id'')::int, "outletId") OR public.is_active_staff(current_setting(''app.current_user_id'')::int) IS FALSE
--   )
-- For now, audit shows RLS enabled but permissive → safe for bootstrap, not production.
