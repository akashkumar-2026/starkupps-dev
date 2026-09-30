-- Outlet architecture: simplify creation — add owner, ensure assignments unique, keep operational config separate

-- 1. Owner / Manager relationship (reuse staff table, no duplicate text field)
ALTER TABLE public.outlets ADD COLUMN IF NOT EXISTS "ownerId" integer REFERENCES public.staff(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_outlets_owner ON public.outlets("ownerId");

-- 2. Ensure outlet_staff is unique per outlet+staff (prevents duplicate assignments)
DO $$ BEGIN
  BEGIN
    ALTER TABLE public.outlet_staff ADD CONSTRAINT outlet_staff_unique UNIQUE ("outletId", "staffId");
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
CREATE INDEX IF NOT EXISTS idx_outlet_staff_outlet ON public.outlet_staff("outletId");
CREATE INDEX IF NOT EXISTS idx_outlet_staff_staff ON public.outlet_staff("staffId");

-- 3. Keep operating hours in outlet_hours (already exists), delivery in delivery_zones + outlets.services
-- No new table for delivery_settings — reuse outlets.services.delivery + delivery_zones; dedicated delivery config UI will use existing tables

-- 4. Ensure outlets code remains unique (already had uniqueIndex, ensure)
DO $$ BEGIN
  BEGIN
    ALTER TABLE public.outlets ADD CONSTRAINT outlets_code_unique UNIQUE (code);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
