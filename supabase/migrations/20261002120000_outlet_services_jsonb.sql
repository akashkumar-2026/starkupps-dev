-- ============================================================================
-- Repair outlets.services, then convert it to jsonb
-- ============================================================================
-- WHY
--
-- `outlets.services` (the per-outlet capability flags: delivery / takeaway /
-- dine-in / POS / online ordering) was stored as a JSON *string* rather than a
-- JSON object:
--
--     SELECT jsonb_typeof(services::jsonb);  -- 'string'  (expected 'object')
--
-- Cause: `outlets.create` bound `JSON.stringify(payload.services)` to this
-- `json` column. `postgres.js` already encodes values destined for a `json`
-- column, so the extra `JSON.stringify` nested the object inside a string.
--
-- IMPACT
--
-- PostgREST returns `json` columns unparsed (unlike `jsonb`), so every reader
-- received a string and `services.delivery` was `undefined`. The checkout guard
--
--     if (services && !services.delivery) throw ...
--
-- is true for any non-empty string, so **every order type was rejected** with
-- "Delivery not available at this outlet." even though the flags all read true.
-- Per-outlet charge overrides were dead for the same reason, and the Admin
-- Services panel rendered `Object.entries()` of a string.
--
-- FIX
--
-- 1. Unwrap the double-encoded values (no-op once repaired).
-- 2. Convert the column to `jsonb` so PostgREST returns a real object and the
--    string/object split cannot recur. Application code reads the column
--    through `shared/outletServices.ts`, which accepts either shape, so the
--    repair is safe regardless of the order these two steps run in.
-- 3. Constrain the column to an object, so a regression fails at the database
--    instead of resurfacing as a checkout outage.
--
-- IDEMPOTENT
--
-- Each step is guarded by its own precondition, so re-running is a no-op.
--
-- NO explicit BEGIN/COMMIT: `scripts/apply-migration.ts` wraps the whole file
-- (and the ledger row) in one transaction. An inner COMMIT would end that
-- transaction early and break the atomicity the script guarantees.
-- ============================================================================

-- ── 1. Unwrap double-encoded values ────────────────────────────────────────
-- `#>>'{}'` extracts the JSON text held *inside* the string and casts it back
-- to json, so '"{\"a\":1}"' becomes '{"a":1}'. Restricted to rows that really
-- are a string containing an object, so a legitimately scalar value is never
-- mangled.
--
-- The shape guard matters: without it this cast raises
-- `invalid input syntax for type json` on a string that is not JSON at all,
-- aborting the whole migration with an opaque error instead of reaching the
-- diagnostic in step 3. Anything unparseable is left untouched here and named
-- there.
UPDATE public.outlets o
   SET services = ((o.services #>> '{}')::json)
 WHERE o.services IS NOT NULL
   AND jsonb_typeof(o.services::jsonb) = 'string'
   AND (o.services #>> '{}') ~ '^\s*[\{\[]'
   AND (o.services #>> '{}') ~ '[\}\]]\s*$';

-- ── 2. Convert to jsonb so PostgREST returns a parsed object ───────────────
-- USING re-parses through jsonb, which also drops duplicate keys and
-- normalises key order. Idempotent: `::jsonb` on a jsonb column is a no-op.
ALTER TABLE public.outlets
  ALTER COLUMN services TYPE jsonb USING services::jsonb;

-- ── 3. Fail loudly rather than leave a landmine ────────────────────────────
-- If any row is still a JSON string the checkout bug is not fixed, and shipping
-- would restore a total order failure. Abort naming the offending outlets.
DO $$
DECLARE
  offenders integer[];
BEGIN
  SELECT array_agg(id ORDER BY id)
    INTO offenders
    FROM public.outlets
   WHERE services IS NOT NULL
     AND jsonb_typeof(services) <> 'object';

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'outlets.services still contains non-object values for outlet id(s) %. '
      'Inspect before retrying: SELECT id, services FROM public.outlets WHERE id = ANY(%).',
      offenders, offenders;
  END IF;
END
$$;

-- ── 4. Guard against the regression returning ───────────────────────────────
-- Null stays allowed (an outlet may have no flags yet); anything else must be
-- an object. This turns the double-encode into a database error at the write
-- site rather than a checkout outage discovered by a customer.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.outlets'::regclass
       AND conname = 'outlets_services_is_object'
  ) THEN
    ALTER TABLE public.outlets
      ADD CONSTRAINT outlets_services_is_object
      CHECK (services IS NULL OR jsonb_typeof(services) = 'object');
  END IF;
END
$$;