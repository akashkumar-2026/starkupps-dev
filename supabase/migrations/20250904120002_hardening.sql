-- Hardening: updatedAt triggers, check constraints, missing indexes
-- Restores MySQL onUpdateNow behavior + adds safety checks PG baseline lost (varchar enums, signed numerics)

-- Generic updatedAt trigger
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for every table with updatedAt (idempotent via DROP IF EXISTS)
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'attendance_records','banners','campaigns','cash_drawers','content_blocks',
    'coupon_redemptions','coupons','customer_segments','customers','deliveries',
    'delivery_zones','expenses','faqs','inventory_categories','inventory_items',
    'leave_requests','loyalty_rules','menu_categories','menu_items','modifier_groups',
    'offers','orders','outlet_hours','outlet_menu_availability','outlets',
    'payments','pos_terminals','prepared_item_batches','prepared_items',
    'purchase_orders','recipes','refunds','riders','shift_templates','staff',
    'stock_transfers','store_settings','suppliers','support_tickets','taxes',
    'testimonials','users','workforce_roles','menu_item_variants','outlet_variant_availability',
    'content_blocks','banners','faqs'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    BEGIN
      EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()', t);
    EXCEPTION WHEN undefined_table THEN
      -- table may not exist (skip)
      NULL;
    END;
  END LOOP;
END $$;

-- Check constraints: non-negative numerics (allow replacing MySQL unsigned)
-- Wrap in DO with exception to allow re-runs
DO $$ BEGIN
  -- menu_items.price >=0
  BEGIN ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_price_nonneg CHECK (price >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- menu_item_variants.price >=0, quantity >=0
  BEGIN ALTER TABLE public.menu_item_variants ADD CONSTRAINT miv_price_nonneg CHECK (price >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.menu_item_variants ADD CONSTRAINT miv_quantity_nonneg CHECK (quantity IS NULL OR quantity >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- orders subtotal/total >=0
  BEGIN ALTER TABLE public.orders ADD CONSTRAINT orders_total_nonneg CHECK (total >= 0 AND subtotal >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- order_items lineTotal >=0, quantity >0
  BEGIN ALTER TABLE public.order_items ADD CONSTRAINT oi_line_nonneg CHECK ("lineTotal" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.order_items ADD CONSTRAINT oi_qty_pos CHECK (quantity > 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- payments amount >=0
  BEGIN ALTER TABLE public.payments ADD CONSTRAINT payments_amount_nonneg CHECK (amount >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- refunds amount >=0
  BEGIN ALTER TABLE public.refunds ADD CONSTRAINT refunds_amount_nonneg CHECK (amount >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- coupons discountValue >=0, minimumOrder >=0
  BEGIN ALTER TABLE public.coupons ADD CONSTRAINT coupons_discount_nonneg CHECK ("discountValue" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- inventory quantity/unitCost >=0
  BEGIN ALTER TABLE public.inventory_items ADD CONSTRAINT inv_qty_nonneg CHECK (quantity >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.inventory_items ADD CONSTRAINT inv_cost_nonneg CHECK ("unitCost" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- cash_drawers openingCash >=0 etc
  BEGIN ALTER TABLE public.cash_drawers ADD CONSTRAINT drawer_opening_nonneg CHECK ("openingCash" >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- wastage quantity >0
  BEGIN ALTER TABLE public.wastage_records ADD CONSTRAINT wastage_qty_pos CHECK (quantity > 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- expenses amount >=0
  BEGIN ALTER TABLE public.expenses ADD CONSTRAINT expenses_amount_nonneg CHECK (amount >= 0); EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- Fix missing table: cash_movements was in schema.pg.ts but not in drizzle/pg baseline
CREATE TABLE IF NOT EXISTS "cash_movements" (
  "id" serial PRIMARY KEY NOT NULL,
  "drawerId" integer NOT NULL REFERENCES "public"."cash_drawers"("id") ON DELETE cascade,
  "outletId" integer NOT NULL REFERENCES "public"."outlets"("id") ON DELETE cascade,
  "terminalId" integer REFERENCES "public"."pos_terminals"("id") ON DELETE set null,
  "direction" varchar(50) NOT NULL,
  "amount" numeric(10,2) NOT NULL,
  "reason" varchar(240) NOT NULL,
  "note" varchar(500),
  "createdBy" integer REFERENCES "public"."staff"("id") ON DELETE set null,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "cash_movements_drawer_idx" ON "cash_movements" USING btree ("drawerId");
CREATE INDEX IF NOT EXISTS "cash_movements_outlet_idx" ON "cash_movements" USING btree ("outletId");
CREATE INDEX IF NOT EXISTS "cash_movements_created_idx" ON "cash_movements" USING btree ("createdAt");

-- Additional useful indexes not in Drizzle baseline (outlet isolation, order lookup)
CREATE INDEX IF NOT EXISTS idx_orders_outlet_status ON public.orders("outletId", status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON public.orders("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_payments_outlet_status ON public.payments("outletId", status);
CREATE INDEX IF NOT EXISTS idx_inventory_items_outlet ON public.inventory_items("outletId") WHERE "outletId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_outlet ON public.outlet_staff("outletId", "staffId");
CREATE INDEX IF NOT EXISTS idx_cash_movements_drawer ON public.cash_movements("drawerId", "createdAt");
