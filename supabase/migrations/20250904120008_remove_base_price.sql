-- Remove Base Price: make variant the sole sellable price
-- Cappuccino: Regular 180ml 140, Medium 250ml 180, Large 350ml 220
-- After this, menu_items.price and outlet_menu_availability.priceOverride are gone.
-- order_items.unitPrice/lineTotal snapshots preserve history.

-- 1) Backfill: for every menu_item without variants, create a default variant from its base price
-- Use "Regular" as default name; quantity/unit remain null (sellable as single size)
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT mi.id, mi.price, mi.name
    FROM public.menu_items mi
    LEFT JOIN public.menu_item_variants v ON v."menuItemId" = mi.id
    GROUP BY mi.id, mi.price, mi.name
    HAVING COUNT(v.id) = 0
  LOOP
    INSERT INTO public.menu_item_variants ("menuItemId", name, quantity, unit, price, sku, available, "isDefault", "sortOrder")
    VALUES (rec.id, 'Regular', NULL, NULL, rec.price, NULL, true, true, 0)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- 1b) Ensure every item with variants has exactly one isDefault (pick first by sortOrder)
DO $$
DECLARE
  item_id int;
BEGIN
  FOR item_id IN SELECT DISTINCT "menuItemId" FROM public.menu_item_variants LOOP
    -- if no default
    PERFORM 1 FROM public.menu_item_variants WHERE "menuItemId" = item_id AND "isDefault" = true LIMIT 1;
    IF NOT FOUND THEN
      UPDATE public.menu_item_variants
      SET "isDefault" = true
      WHERE id = (SELECT id FROM public.menu_item_variants WHERE "menuItemId" = item_id ORDER BY "sortOrder" ASC, id ASC LIMIT 1);
    END IF;
    -- if multiple defaults, keep only first
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY "menuItemId" ORDER BY "sortOrder" ASC, id ASC) AS rn
      FROM public.menu_item_variants WHERE "menuItemId" = item_id AND "isDefault" = true
    )
    UPDATE public.menu_item_variants SET "isDefault" = false
    WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
  END LOOP;
END $$;

-- 2) Drop product-level priceOverride (now variant-level only via outlet_variant_availability)
ALTER TABLE public.outlet_menu_availability DROP COLUMN IF EXISTS "priceOverride";

-- 3) Remove base price column from menu_items
-- Order of operations: column is NOT NULL, but all rows now have variants, so safe to drop.
ALTER TABLE public.menu_items DROP COLUMN IF EXISTS price;

-- 4) Add constraint to ensure variant price is positive (preserve hardening, variant already NOT NULL)
-- No new constraint needed; variant price already CHECK >=0 via hardening.

-- 5) Comment for discoverability
COMMENT ON TABLE public.menu_items IS 'Menu item header; sellable price is in menu_item_variants.price (not here)';
COMMENT ON TABLE public.menu_item_variants IS 'Sellable SKUs: each variant has its own price (e.g. Regular 180ml 140, Large 350ml 220)';
