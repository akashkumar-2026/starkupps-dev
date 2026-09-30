-- Performance indexes for the admin query paths (audit finding F-16 and related).
--
-- These columns are used for equality/lookup and range filtering but were not
-- indexed. Plain (non-unique) indexes are added intentionally: `orders.orderNumber`
-- and `coupons.code` currently contain no uniqueness guarantee, and adding a
-- UNIQUE index requires a data de-duplication step first (tracked separately).
--
-- Idempotent: safe to re-run.

CREATE INDEX IF NOT EXISTS idx_orders_order_number ON public.orders("orderNumber");
CREATE INDEX IF NOT EXISTS idx_orders_customer ON public.orders("customerId");
CREATE INDEX IF NOT EXISTS idx_orders_outlet_created ON public.orders("outletId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON public.coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON public.coupon_redemptions("couponId");
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_created ON public.coupon_redemptions("createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_customers_email ON public.customers(email);
CREATE INDEX IF NOT EXISTS idx_staff_email ON public.staff(email);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);

CREATE INDEX IF NOT EXISTS idx_inventory_items_sku ON public.inventory_items(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_item ON public.inventory_batches("inventoryItemId");
CREATE INDEX IF NOT EXISTS idx_outlet_menu_availability_item ON public.outlet_menu_availability("outletId", "menuItemId");

-- Case-insensitive SKU uniqueness checks use lower(sku).
CREATE INDEX IF NOT EXISTS idx_menu_item_variants_sku_lower ON public.menu_item_variants (lower(sku));

-- Staff performance aggregation and activity feed.
CREATE INDEX IF NOT EXISTS idx_audit_actor_entity ON public.audit_log("actorUserId", "entityType");
CREATE INDEX IF NOT EXISTS idx_attendance_staff ON public.attendance_records("staffId");
