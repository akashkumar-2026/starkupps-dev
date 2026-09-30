-- POS decommission: remove objects exclusive to the starkupps-pos counter app.
--
-- Tables pos_terminals / pos_sessions / cash_drawers / cash_movements were
-- used only by the POS counter flows (terminal registration, operator
-- shifts, cash register ledger). The staff.posPin* columns served only the
-- POS operator PIN (generation/verification/lockout). All were verified
-- empty (0 rows) with no production data before removal.
--
-- PRESERVED (shared with Admin/Web): orders (+ source/idempotencyKey/
-- tableNo/terminalId/shiftId columns and historical source='pos' rows),
-- order_items, payments, customers, coupons, coupon_redemptions, menu_*,
-- outlets, outlet_staff, staff (table), shifts, shift_templates, users,
-- sessions (+ audience), inventory_*, finance reads, audit_log (history is
-- never deleted), storage buckets, realtime for remaining tables.
--
-- Dependency order: cash_movements -> cash_drawers -> pos_sessions ->
-- pos_terminals, then staff columns. Dropping a table also drops its
-- indexes, triggers, RLS state and realtime publication membership.
-- Run with: supabase db push --linked

-- Cash ledger (register moves reference their drawer)
DROP TABLE IF EXISTS public.cash_movements;

-- Cash drawers (per-terminal/per-outlet register state)
DROP TABLE IF EXISTS public.cash_drawers;

-- POS operator shifts
DROP TABLE IF EXISTS public.pos_sessions;

-- POS counter terminals
DROP TABLE IF EXISTS public.pos_terminals;

-- Operator PIN columns on shared staff table (table itself is preserved)
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS "staff_posPinSetBy_users_id_fk";
ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_pospinsetby_users_id_fk;
ALTER TABLE public.staff DROP COLUMN IF EXISTS "posPinHash";
ALTER TABLE public.staff DROP COLUMN IF EXISTS "posPinSetAt";
ALTER TABLE public.staff DROP COLUMN IF EXISTS "posPinSetBy";
ALTER TABLE public.staff DROP COLUMN IF EXISTS "posPinFailedAttempts";
ALTER TABLE public.staff DROP COLUMN IF EXISTS "posPinLockedUntil";
