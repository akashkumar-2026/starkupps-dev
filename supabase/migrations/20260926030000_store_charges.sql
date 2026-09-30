-- Configurable store charges: packing, delivery, free-delivery threshold.
--
-- Audit finding M3: packing (15), delivery (29) and taxes (0) were hardcoded
-- in the gateway. These columns make them operator-configurable via Store
-- settings; per-outlet overrides remain possible through
-- outlets.services->{packingCharge,deliveryFee}. Existing rows pick up the
-- previous hardcoded behavior as defaults.
--
-- Idempotent: safe to re-run. Run with: npx supabase db push --linked

ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS "packingCharge" numeric(10,2) NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS "deliveryFee" numeric(10,2) NOT NULL DEFAULT 29,
  ADD COLUMN IF NOT EXISTS "freeDeliveryAbove" numeric(10,2);

COMMENT ON COLUMN public.store_settings."packingCharge" IS 'Packing charge applied to takeaway + delivery orders (0 for dine-in)';
COMMENT ON COLUMN public.store_settings."deliveryFee" IS 'Delivery fee applied to delivery orders';
COMMENT ON COLUMN public.store_settings."freeDeliveryAbove" IS 'Orders with (subtotal - discount) at or above this amount get free delivery; NULL disables';
