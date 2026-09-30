-- ============================================================================
-- Local seed data (applied by `supabase db reset`, after migrations).
-- ============================================================================
-- `supabase/config.toml` declares `[db.seed] sql_paths = ["./seed.sql"]`, but the
-- file did not exist, so a local reset failed (or silently skipped) at the seed
-- step.
--
-- IMPORTANT: this is LOCAL reference data only. It must never create a login.
--
--   * NO user/admin accounts. Those are created deliberately with
--     `npm run db:seed`, which generates a strong password and prints it once.
--     Seeding an account here would reintroduce a known-credential backdoor.
--   * Reference/catalog rows that migrations create conditionally (to avoid
--     duplicate-key errors) are only ensured here so a local reset has usable
--     data. Every insert is idempotent.
-- ============================================================================

-- ── System roles ────────────────────────────────────────────────────────────
INSERT INTO public.workforce_roles (name, slug, description, "isSystem")
VALUES
  ('Super Admin', 'super_admin', 'Full access across all outlets', true),
  ('Outlet Manager', 'outlet_manager', 'Manages a single outlet', true),
  ('Shift Manager', 'shift_manager', 'Runs a single shift', true),
  ('POS Staff', 'pos_staff', 'Counter service only', true),
  ('Kitchen Staff', 'kitchen_staff', 'Kitchen operations only', true),
  ('Inventory Staff', 'inventory_staff', 'Stock and purchasing', true),
  ('Delivery Coordinator', 'delivery_coordinator', 'Delivery dispatch', true),
  ('Support Staff', 'support_staff', 'Customer support', true)
ON CONFLICT (name) DO NOTHING;

-- ── Permission catalog ──────────────────────────────────────────────────────
-- Mirrors shared/permissions.ts. `key` has no UNIQUE constraint in the schema,
-- so the existence check is explicit.
INSERT INTO public.workforce_permissions (key, description, category)
SELECT k.key, k.key, k.category FROM (VALUES
  ('orders.read','Orders'),('orders.create','Orders'),('orders.update','Orders'),('orders.cancel','Orders'),
  ('menu.read','Menu'),('menu.create','Menu'),('menu.update','Menu'),('menu.delete','Menu'),
  ('inventory.read','Inventory'),('inventory.adjust','Inventory'),('inventory.manage','Inventory'),
  ('customers.read','Customers'),('customers.update','Customers'),
  ('staff.read','Staff'),('staff.create','Staff'),('staff.update','Staff'),
  ('finance.read','Finance'),('finance.refund','Finance'),('finance.expenses','Finance'),('finance.taxes','Finance'),
  ('reports.read','Reports'),
  ('settings.read','Settings'),('settings.update','Settings')
) AS k(key, category)
WHERE NOT EXISTS (SELECT 1 FROM public.workforce_permissions p WHERE p.key = k.key);