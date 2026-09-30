-- F-17: enforce uniqueness on human-facing business identifiers where the data
-- is already clean. `orders.orderNumber` and `coupons.code` previously had no
-- uniqueness guarantee (duplicate tickets/codes were possible).
--
-- This migration only creates the UNIQUE index when no duplicates exist; if
-- duplicates are found it raises a notice and skips, so it can never fail on
-- dirty production data. The non-unique lookup indexes from
-- `20260926060000_perf_indexes.sql` remain in place either way.
--
-- Idempotent: safe to re-run.

DO $$
DECLARE dup_count int;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT "orderNumber" FROM public.orders GROUP BY "orderNumber" HAVING count(*) > 1
  ) d;
  IF dup_count = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_order_number ON public.orders("orderNumber");
    RAISE NOTICE 'uq_orders_order_number created';
  ELSE
    RAISE NOTICE 'Skipped uq_orders_order_number: % duplicate order number group(s) require cleanup', dup_count;
  END IF;

  SELECT count(*) INTO dup_count FROM (
    SELECT code FROM public.coupons GROUP BY code HAVING count(*) > 1
  ) d;
  IF dup_count = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_coupons_code ON public.coupons(code);
    RAISE NOTICE 'uq_coupons_code created';
  ELSE
    RAISE NOTICE 'Skipped uq_coupons_code: % duplicate coupon code group(s) require cleanup', dup_count;
  END IF;
END $$;
