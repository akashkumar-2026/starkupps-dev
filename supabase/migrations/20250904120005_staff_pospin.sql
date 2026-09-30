-- Fixup: add missing staff POS PIN columns (stale PG baseline omitted them)
-- Drizzle pg 0000 was generated before posPin fields; need to add them for seed

ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "posPinHash" varchar(512);
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "posPinSetAt" timestamp;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "posPinSetBy" integer;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "posPinFailedAttempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS "posPinLockedUntil" timestamp;

-- FK for posPinSetBy -> users (idempotent)
DO $$ BEGIN
  BEGIN
    ALTER TABLE public.staff ADD CONSTRAINT "staff_posPinSetBy_users_id_fk" FOREIGN KEY ("posPinSetBy") REFERENCES public.users(id) ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- cash_movements already added in 20250904120002_hardening, but ensure FKs exist if table was pre-existing
DO $$ BEGIN
  BEGIN
    ALTER TABLE public.cash_movements ADD CONSTRAINT "cash_movements_drawerId_cash_drawers_id_fk" FOREIGN KEY ("drawerId") REFERENCES public.cash_drawers(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER TABLE public.cash_movements ADD CONSTRAINT "cash_movements_outletId_outlets_id_fk" FOREIGN KEY ("outletId") REFERENCES public.outlets(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
