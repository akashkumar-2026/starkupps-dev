-- Seed reference data so the app no longer fabricates records in code.
--
-- Audit findings M1/M2/M9: when workforce_roles / workforce_permissions /
-- customer_segments are empty, the gateway returned hardcoded records
-- (including negative ids) instead of real rows. This migration inserts the
-- same reference rows into the database (idempotently), after which the
-- hardcoded fallbacks are removed from the server code.
--
-- Idempotent: safe to re-run. Run with: npx supabase db push --linked

-- ============================================================
-- 1. workforce_roles (8 operational roles)
-- ============================================================
INSERT INTO public.workforce_roles (name, slug, description, "isSystem")
VALUES
  ('Super Admin', 'super_admin', 'Full access across all outlets', true),
  ('Outlet Manager', 'outlet_manager', 'Manages single outlet', true),
  ('Shift Manager', 'shift_manager', 'Manages shifts', true),
  ('POS Staff', 'pos_staff', 'POS operations', true),
  ('Kitchen Staff', 'kitchen_staff', 'Kitchen orders', true),
  ('Inventory Staff', 'inventory_staff', 'Inventory', true),
  ('Delivery Coordinator', 'delivery_coordinator', 'Delivery', true),
  ('Support Staff', 'support_staff', 'Support', true)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 2. workforce_permissions (same 19-key catalog the app previously hardcoded)
-- ============================================================
INSERT INTO public.workforce_permissions (key, description, category)
SELECT k.key, k.key, k.category FROM (VALUES
  ('orders.read','Orders'),('orders.create','Orders'),('orders.update','Orders'),('orders.cancel','Orders'),
  ('menu.read','Menu'),('menu.create','Menu'),('menu.update','Menu'),
  ('inventory.read','Inventory'),('inventory.adjust','Inventory'),
  ('customers.read','Customers'),
  ('staff.read','Staff'),('staff.create','Staff'),('staff.update','Staff'),('staff.suspend','Staff'),
  ('finance.read','Finance'),('finance.refund','Finance'),
  ('reports.read','Reports'),
  ('settings.read','Settings'),('settings.update','Settings')
) AS k(key, category)
WHERE NOT EXISTS (SELECT 1 FROM public.workforce_permissions p WHERE p.key = k.key);

-- ============================================================
-- 3. workforce_role_permissions (seed only if the matrix is empty)
--    Mapping mirrors shared/permissions.ts ROLE_PERMISSIONS:
--      Super Admin        -> owner grants
--      Outlet/Shift Mgr   -> manager grants
--      POS/Kitchen/Inv/Delivery/Support -> staff grants
-- ============================================================
WITH perms AS (
  SELECT id AS role_id, slug FROM public.workforce_roles
  WHERE slug IN ('super_admin','outlet_manager','shift_manager','pos_staff','kitchen_staff','inventory_staff','delivery_coordinator','support_staff')
),
grants(role_slug, permission_key) AS (
  VALUES
  -- owner grants (Super Admin)
  ('super_admin','orders.read'),('super_admin','orders.create'),('super_admin','orders.update'),('super_admin','orders.cancel'),
  ('super_admin','menu.read'),('super_admin','menu.create'),('super_admin','menu.update'),
  ('super_admin','inventory.read'),('super_admin','inventory.adjust'),
  ('super_admin','customers.read'),
  ('super_admin','staff.read'),('super_admin','staff.create'),('super_admin','staff.update'),
  ('super_admin','finance.read'),('super_admin','finance.refund'),
  ('super_admin','settings.read'),('super_admin','settings.update'),
  -- manager grants (Outlet Manager, Shift Manager)
  ('outlet_manager','orders.read'),('outlet_manager','orders.create'),('outlet_manager','orders.update'),('outlet_manager','orders.cancel'),
  ('outlet_manager','menu.read'),('outlet_manager','menu.create'),('outlet_manager','menu.update'),
  ('outlet_manager','inventory.read'),('outlet_manager','inventory.adjust'),
  ('outlet_manager','customers.read'),
  ('outlet_manager','staff.read'),
  ('outlet_manager','finance.read'),
  ('outlet_manager','settings.read'),
  ('shift_manager','orders.read'),('shift_manager','orders.create'),('shift_manager','orders.update'),('shift_manager','orders.cancel'),
  ('shift_manager','menu.read'),('shift_manager','menu.create'),('shift_manager','menu.update'),
  ('shift_manager','inventory.read'),('shift_manager','inventory.adjust'),
  ('shift_manager','customers.read'),
  ('shift_manager','staff.read'),
  ('shift_manager','finance.read'),
  ('shift_manager','settings.read'),
  -- staff grants (operational roles)
  ('pos_staff','orders.read'),('pos_staff','orders.update'),
  ('pos_staff','menu.read'),
  ('pos_staff','inventory.read'),('pos_staff','inventory.adjust'),
  ('pos_staff','customers.read'),
  ('kitchen_staff','orders.read'),('kitchen_staff','orders.update'),
  ('kitchen_staff','menu.read'),
  ('kitchen_staff','inventory.read'),
  ('inventory_staff','inventory.read'),('inventory_staff','inventory.adjust'),
  ('inventory_staff','menu.read'),
  ('delivery_coordinator','orders.read'),
  ('delivery_coordinator','customers.read'),
  ('support_staff','orders.read'),
  ('support_staff','customers.read')
)
INSERT INTO public.workforce_role_permissions ("roleId", "permissionKey")
SELECT p.role_id, g.permission_key
FROM grants g JOIN perms p ON p.slug = g.role_slug
WHERE NOT EXISTS (SELECT 1 FROM public.workforce_role_permissions)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. customer_segments (4 default segments)
-- ============================================================
INSERT INTO public.customer_segments (name, slug, description, rules)
SELECT s.name, s.slug, s.description, s.rules::json FROM (VALUES
  ('New Customers','new','First order within 30 days','{"minOrders":1,"maxOrders":1}'),
  ('Returning Customers','returning','2+ orders','{"minOrders":2}'),
  ('VIP','vip','High spenders','{"minSpend":5000}'),
  ('Inactive 30 Days','inactive-30','No order in 30 days','{"inactiveDays":30}')
) AS s(name, slug, description, rules)
WHERE NOT EXISTS (SELECT 1 FROM public.customer_segments c WHERE c.slug = s.slug);

-- ============================================================
-- 5. loyalty_rules (default earn/burn) — only if empty
-- ============================================================
INSERT INTO public.loyalty_rules ("pointsPerRupee","rewardThreshold","rewardLabel")
SELECT 0.1, 1000, 'Reward unlocked'
WHERE NOT EXISTS (SELECT 1 FROM public.loyalty_rules);

-- ============================================================
-- 6. store_settings (default row) — only if empty
-- ============================================================
INSERT INTO public.store_settings ("storeName","timezone","openForOrders","autoAcceptOrders","openingTime","closingTime")
SELECT 'StarKupps','Asia/Kolkata',false,false,'08:00','23:00'
WHERE NOT EXISTS (SELECT 1 FROM public.store_settings);
