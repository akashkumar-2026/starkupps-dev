-- Schema hardening: foreign keys, status checks, and query-driven indexes.
--
-- Audit finding: most logical relations have no FK (lost in the
-- Drizzle->Supabase baseline) and status columns are unconstrained varchar.
-- All constraints are added NOT VALID so the migration cannot fail on
-- historical rows; they are enforced for every new/updated row going
-- forward. Run VALIDATE CONSTRAINT after cleaning historical orphans.
--
-- Idempotent: safe to re-run. Run with: npx supabase db push --linked

-- ============================================================
-- 1. Foreign keys (NOT VALID — enforced for new writes)
-- ============================================================
DO $$
BEGIN
  -- order_items
  BEGIN ALTER TABLE public.order_items ADD CONSTRAINT order_items_order_fk FOREIGN KEY ("orderId") REFERENCES public.orders(id) ON DELETE CASCADE NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.order_items ADD CONSTRAINT order_items_menu_item_fk FOREIGN KEY ("menuItemId") REFERENCES public.menu_items(id) ON DELETE SET NULL NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- orders
  BEGIN ALTER TABLE public.orders ADD CONSTRAINT orders_customer_fk FOREIGN KEY ("customerId") REFERENCES public.customers(id) ON DELETE SET NULL NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.orders ADD CONSTRAINT orders_outlet_fk FOREIGN KEY ("outletId") REFERENCES public.outlets(id) ON DELETE SET NULL NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- payments / refunds
  BEGIN ALTER TABLE public.payments ADD CONSTRAINT payments_order_fk FOREIGN KEY ("orderId") REFERENCES public.orders(id) ON DELETE CASCADE NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.refunds ADD CONSTRAINT refunds_order_fk FOREIGN KEY ("orderId") REFERENCES public.orders(id) ON DELETE CASCADE NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.refunds ADD CONSTRAINT refunds_payment_fk FOREIGN KEY ("paymentId") REFERENCES public.payments(id) ON DELETE SET NULL NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- deliveries
  BEGIN ALTER TABLE public.deliveries ADD CONSTRAINT deliveries_order_fk FOREIGN KEY ("orderId") REFERENCES public.orders(id) ON DELETE CASCADE NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.deliveries ADD CONSTRAINT deliveries_rider_fk FOREIGN KEY ("riderId") REFERENCES public.riders(id) ON DELETE SET NULL NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- coupons
  BEGIN ALTER TABLE public.coupon_redemptions ADD CONSTRAINT coupon_redemptions_coupon_fk FOREIGN KEY ("couponId") REFERENCES public.coupons(id) ON DELETE CASCADE NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.coupon_redemptions ADD CONSTRAINT coupon_redemptions_order_fk FOREIGN KEY ("orderId") REFERENCES public.orders(id) ON DELETE CASCADE NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.coupon_redemptions ADD CONSTRAINT coupon_redemptions_customer_fk FOREIGN KEY ("customerId") REFERENCES public.customers(id) ON DELETE SET NULL NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- outlet membership
  BEGIN ALTER TABLE public.outlet_staff ADD CONSTRAINT outlet_staff_staff_fk FOREIGN KEY ("staffId") REFERENCES public.staff(id) ON DELETE CASCADE NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.outlet_staff ADD CONSTRAINT outlet_staff_outlet_fk FOREIGN KEY ("outletId") REFERENCES public.outlets(id) ON DELETE CASCADE NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.staff ADD CONSTRAINT staff_primary_outlet_fk FOREIGN KEY ("primaryOutletId") REFERENCES public.outlets(id) ON DELETE SET NULL NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- notifications / audit
  BEGIN ALTER TABLE public.notifications ADD CONSTRAINT notifications_recipient_fk FOREIGN KEY ("recipientUserId") REFERENCES public.users(id) ON DELETE CASCADE NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_actor_fk FOREIGN KEY ("actorUserId") REFERENCES public.users(id) ON DELETE SET NULL NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- inventory history (RESTRICT: never orphan immutable movements)
  BEGIN ALTER TABLE public.inventory_transactions ADD CONSTRAINT inventory_transactions_item_fk FOREIGN KEY ("inventoryItemId") REFERENCES public.inventory_items(id) ON DELETE RESTRICT NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.purchase_order_lines ADD CONSTRAINT po_lines_po_fk FOREIGN KEY ("purchaseOrderId") REFERENCES public.purchase_orders(id) ON DELETE CASCADE NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.purchase_order_lines ADD CONSTRAINT po_lines_item_fk FOREIGN KEY ("inventoryItemId") REFERENCES public.inventory_items(id) ON DELETE RESTRICT NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.stock_transfer_items ADD CONSTRAINT transfer_items_transfer_fk FOREIGN KEY ("transferId") REFERENCES public.stock_transfers(id) ON DELETE CASCADE NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- support
  BEGIN ALTER TABLE public.support_messages ADD CONSTRAINT support_messages_ticket_fk FOREIGN KEY ("ticketId") REFERENCES public.support_tickets(id) ON DELETE CASCADE NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_order_fk FOREIGN KEY ("orderId") REFERENCES public.orders(id) ON DELETE SET NULL NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_customer_fk FOREIGN KEY ("customerId") REFERENCES public.customers(id) ON DELETE SET NULL NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- workforce
  BEGIN ALTER TABLE public.attendance_records ADD CONSTRAINT attendance_staff_fk FOREIGN KEY ("staffId") REFERENCES public.staff(id) ON DELETE CASCADE NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.leave_requests ADD CONSTRAINT leave_staff_fk FOREIGN KEY ("staffId") REFERENCES public.staff(id) ON DELETE CASCADE NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.staff_schedules ADD CONSTRAINT schedules_staff_fk FOREIGN KEY ("staffId") REFERENCES public.staff(id) ON DELETE CASCADE NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  -- loyalty / feedback
  BEGIN ALTER TABLE public.loyalty_transactions ADD CONSTRAINT loyalty_customer_fk FOREIGN KEY ("customerId") REFERENCES public.customers(id) ON DELETE CASCADE NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.customer_feedback ADD CONSTRAINT feedback_customer_fk FOREIGN KEY ("customerId") REFERENCES public.customers(id) ON DELETE CASCADE NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ============================================================
-- 2. Status CHECKs (NOT VALID — enforced for new writes)
-- ============================================================
DO $$
BEGIN
  BEGIN ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (status IN ('new','preparing','ready','completed','cancelled')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.orders ADD CONSTRAINT orders_payment_status_check CHECK ("paymentStatus" IN ('unpaid','paid','refunded','failed')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.orders ADD CONSTRAINT orders_type_check CHECK (type IN ('dine_in','takeaway','delivery')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.payments ADD CONSTRAINT payments_status_check CHECK (status IN ('pending','paid','failed','refunded')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.refunds ADD CONSTRAINT refunds_status_check CHECK (status IN ('requested','validated','refunded','failed','cancelled')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.deliveries ADD CONSTRAINT deliveries_status_check CHECK (status IN ('preparing','ready','rider_assigned','picked_up','out_for_delivery','delivered','failed','cancelled')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.purchase_orders ADD CONSTRAINT po_status_check CHECK (status IN ('draft','ordered','partially_received','received','cancelled')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER TABLE public.coupons ADD CONSTRAINT coupons_status_check CHECK (status IN ('draft','scheduled','active','paused','archived')) NOT VALID; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ============================================================
-- 3. Query-driven indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_orders_customer ON public.orders("customerId");
CREATE INDEX IF NOT EXISTS idx_orders_outlet_created ON public.orders("outletId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items("orderId");
CREATE INDEX IF NOT EXISTS idx_redemptions_coupon_customer ON public.coupon_redemptions("couponId", "customerId", "status");
CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers("phone");
CREATE INDEX IF NOT EXISTS idx_deliveries_order ON public.deliveries("orderId");
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON public.menu_items("categoryId");
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications("recipientUserId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON public.audit_log("entityType", "action", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_item ON public.inventory_transactions("inventoryItemId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_po_lines_po ON public.purchase_order_lines("purchaseOrderId");
