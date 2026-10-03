-- ============================================================================
-- Persist the full order-time customer snapshot and the charge breakdown
-- ============================================================================
-- WHY
--
-- `public.orders.create` validated the customer's delivery address and then
-- threw it away:
--
--     if (input.type === "delivery" && !input.customer.address)
--       throw new TRPCError({ ... DELIVERY_ADDRESS_REQUIRED });
--
-- but the INSERT that followed bound only 15 columns:
--
--     INSERT INTO "orders" ("orderNumber","customerId","outletId","shiftId",
--       "type","source","status","subtotal","total","paymentStatus","couponId",
--       "couponCode","couponDiscount","notes","idempotencyKey") ...
--
-- Neither `orders` nor `customers` had a column able to hold an address, so a
-- rider and the Admin order ticket could never see where a delivery order was
-- going. The same INSERT persisted only `subtotal`, `couponDiscount` and
-- `total`, so the packing / delivery / tax figures that `computeOrderQuote`
-- had just computed were returned to the browser and then dropped — an order
-- showing `subtotal 55 / total 70` could not be explained from its own row.
--
-- Customer name and phone lived only on `customers`, which is shared mutable
-- state: editing a profile (or a later order from the same number) rewrites
-- what a historical ticket claims the customer gave us. Item names already
-- snapshot onto `order_items`; the customer record did not.
--
-- FIX
--
-- 1. Add order-time snapshot columns for the customer-supplied fields.
-- 2. Add the charge breakdown so a stored total can always be reconciled.
-- 3. Backfill the customer snapshot from `customers` for historical rows, and
--    backfill `chargesTotal` from arithmetic that the existing columns already
--    permit (`total = (subtotal - couponDiscount) + chargesTotal`).
--
-- WHAT IS *NOT* BACKFILLED
--
-- `deliveryAddress` and the packing/delivery/tax split are left NULL/zero for
-- pre-existing rows. They were never stored, and reconstructing a plausible
-- address would be fabricating customer data. The Admin order ticket renders
-- "Not recorded" / a combined "charges & taxes" line for those orders, so an
-- old ticket is visibly less specific than a new one rather than quietly
-- wrong.
--
-- SAFETY
--
-- * Every new column is nullable or carries a DEFAULT, so existing rows stay
--   valid and no rewrite is required.
-- * `ADD COLUMN IF NOT EXISTS` / `DO $$ ... IF NOT EXISTS` make this
--   re-runnable.
-- * New CHECK constraints are validated against existing data and are written
--   to hold trivially for the backfilled zeros.
-- * No existing column is dropped, renamed or retyped.
--
-- NO explicit BEGIN/COMMIT: `scripts/apply-migration.ts` wraps this file and
-- its ledger row in one transaction.
-- ============================================================================

-- ── 1 & 2. Additive columns ────────────────────────────────────────────────
-- Snapshot of what the customer supplied at checkout. Deliberately denormalised
-- onto the order: `customers` is a shared, editable profile, and a receipt must
-- keep saying what was actually ordered.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS "customerName"  varchar(160),
  ADD COLUMN IF NOT EXISTS "customerPhone" varchar(32),
  ADD COLUMN IF NOT EXISTS "customerEmail" varchar(320),
  -- Only populated for `type = 'delivery'`. NULL on dine-in / takeaway, and on
  -- historical delivery orders whose address was discarded.
  ADD COLUMN IF NOT EXISTS "deliveryAddress" text,
  -- Charge breakdown as quoted by `computeOrderQuote` at order time.
  ADD COLUMN IF NOT EXISTS "packingCharge" numeric(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "deliveryFee"   numeric(10, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taxAmount"     numeric(10, 2) NOT NULL DEFAULT 0,
  -- The per-line tax breakdown, e.g.
  --   [{"name":"CGST","rate":2.5,"amount":1.38},{"name":"SGST","rate":2.5,"amount":1.38}]
  ADD COLUMN IF NOT EXISTS "taxBreakdown" jsonb,
  -- Sum of the above. Backfillable for historical rows; stored so the Admin
  -- ticket and finance reports never re-derive it.
  ADD COLUMN IF NOT EXISTS "chargesTotal"  numeric(10, 2) NOT NULL DEFAULT 0;

-- ── 3. Backfill ────────────────────────────────────────────────────────────
-- Customer snapshot, from the profile the order was attached to. Rows whose
-- customer has since been deleted keep NULLs and render as "not recorded".
UPDATE public.orders o
   SET "customerName"  = c."name",
       "customerPhone" = c."phone",
       "customerEmail" = c."email"
  FROM public.customers c
 WHERE c."id" = o."customerId"
   AND (o."customerName"  IS DISTINCT FROM c."name"
     OR o."customerPhone" IS DISTINCT FROM c."phone"
     OR o."customerEmail" IS DISTINCT FROM c."email");

-- Combined charges, recovered from the identity the quote engine guarantees:
--
--     taxable        = subtotal - couponDiscount
--     total          = taxable + chargesTotal
--   => chargesTotal  = total - subtotal + couponDiscount
--
-- Clamped at 0 because legacy rows predate that invariant and a negative
-- "charges" figure would be meaningless on a ticket.
UPDATE public.orders
   SET "chargesTotal" = GREATEST(
         0,
         "total" - "subtotal" + "couponDiscount"
       )
 WHERE "chargesTotal" = 0
   AND "total" - "subtotal" + "couponDiscount" > 0;

-- ── 4. Constraints ─────────────────────────────────────────────────────────
-- Guards: a negative charge line would silently shrink a stored total, and a
-- non-array `taxBreakdown` would break `.map()` in the Admin order ticket.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.orders'::regclass
       AND conname = 'orders_charges_nonneg'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_charges_nonneg
      CHECK ("packingCharge" >= 0 AND "deliveryFee" >= 0
         AND "taxAmount" >= 0 AND "chargesTotal" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.orders'::regclass
       AND conname = 'orders_tax_breakdown_is_array'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_tax_breakdown_is_array
      CHECK ("taxBreakdown" IS NULL OR jsonb_typeof("taxBreakdown") = 'array');
  END IF;

  -- A delivery address only means anything for a delivery order. Order-numbered
  -- historical rows all satisfy this (none has an address), so it is safe to
  -- enforce — and it stops a future writer from attaching a doorstep to a
  -- takeaway ticket.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.orders'::regclass
       AND conname = 'orders_address_only_for_delivery'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_address_only_for_delivery
      CHECK ("deliveryAddress" IS NULL OR "type" = 'delivery');
  END IF;
END
$$;

-- ── 5. Indexes ─────────────────────────────────────────────────────────────
-- The order ticket is fetched by primary key and the queue by
-- (outletId, createdAt DESC) / (status, createdAt DESC), all already indexed.
-- The one genuinely new access path is the Admin queue's phone search, which
-- currently ILIKEs the joined `customers.phone` and therefore cannot use an
-- index. A partial index on the snapshot keeps that search on the order row
-- itself and serves the new "customer phone" column at the same time.
--
-- `text_pattern_ops` matches the `ILIKE '%…%'` shape used by the search box.
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone
  ON public.orders USING btree ("customerPhone" text_pattern_ops)
  WHERE "customerPhone" IS NOT NULL;