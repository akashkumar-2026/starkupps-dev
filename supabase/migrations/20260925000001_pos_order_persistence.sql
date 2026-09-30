-- POS order persistence: idempotency + terminal/table context on orders.
-- The POS client sends idempotencyKey / tableNo / terminalId with every
-- pos.orders.create; the gateway must persist them so retries are safe and
-- receipts can be reconciled. Additive only — no existing columns touched.
-- Run with: npx supabase db push --linked

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "idempotencyKey" varchar(80);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "tableNo" varchar(20);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS "terminalId" integer;

-- Arbiter for INSERT ... ON CONFLICT ("idempotencyKey") in pos.orders.create.
-- Multiple NULLs are allowed, so orders created without a key are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key
  ON public.orders("idempotencyKey");
