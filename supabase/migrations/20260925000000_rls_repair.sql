-- RLS repair + rate_limits convergence (Supabase-only data plane)
--
-- 1. Qualify the permissive policies on auth tables to service_role.
--    The app server always uses the service_role client (which bypasses RLS),
--    so behavior is unchanged — but a bare USING (true) policy would also
--    match anon/authenticated roles. TO service_role makes deny-anon explicit.
-- 2. Enable RLS on csrf_tokens / session_limits (created without it).
-- 3. Converge public.rate_limits to the shape used by
--    server/_core/rateLimit.ts (key/count/reset_at). Migration
--    20260909060000 defined a different shape under IF NOT EXISTS plus
--    indexes referencing columns that may not exist, so fresh applies could
--    fail and the two states diverge. This repair is idempotent on either.
-- Run with: npx supabase db push --linked

-- ============================================================
-- 1. Auth tables: service_role-scoped policies
-- ============================================================
DROP POLICY IF EXISTS "service_role_full_access" ON public.sessions;
CREATE POLICY "service_role_full_access" ON public.sessions
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_full_access" ON public.password_resets;
CREATE POLICY "service_role_full_access" ON public.password_resets
  TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 2. RLS for CSRF / session-limit tables (guarded: tables may not
--    exist on databases that never applied ...09060000)
-- ============================================================
DO $$
BEGIN
  IF to_regclass('public.csrf_tokens') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.csrf_tokens ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "service_role_full_access" ON public.csrf_tokens';
    EXECUTE 'CREATE POLICY "service_role_full_access" ON public.csrf_tokens TO service_role USING (true) WITH CHECK (true)';
  END IF;
  IF to_regclass('public.session_limits') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.session_limits ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "service_role_full_access" ON public.session_limits';
    EXECUTE 'CREATE POLICY "service_role_full_access" ON public.session_limits TO service_role USING (true) WITH CHECK (true)';
  END IF;
END
$$;

-- ============================================================
-- 3. rate_limits: converge to the canonical (key/count/reset_at) shape
-- ============================================================
-- Ensure canonical columns exist regardless of which shape was created.
ALTER TABLE public.rate_limits ADD COLUMN IF NOT EXISTS key varchar(255);
ALTER TABLE public.rate_limits ADD COLUMN IF NOT EXISTS count integer NOT NULL DEFAULT 0;
ALTER TABLE public.rate_limits ADD COLUMN IF NOT EXISTS reset_at timestamptz;

-- Drop indexes from the divergent shape (they reference columns the
-- canonical shape does not have and would break fresh applies).
DROP INDEX IF EXISTS public.idx_rate_limits_key_type;
DROP INDEX IF EXISTS public.idx_rate_limits_window_end;
DROP INDEX IF EXISTS public.idx_rate_limits_blocked;
DROP INDEX IF EXISTS public.idx_rate_limits_window_end_brin;

-- Relax new-shape-only NOT NULL constraints so canonical writes
-- (key/count/reset_at) succeed on databases that got the new shape.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rate_limits' AND column_name = 'type' AND is_nullable = 'NO') THEN
    ALTER TABLE public.rate_limits ALTER COLUMN type DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rate_limits' AND column_name = 'window_end' AND is_nullable = 'NO') THEN
    ALTER TABLE public.rate_limits ALTER COLUMN window_end DROP NOT NULL;
  END IF;
END
$$;

-- ON CONFLICT(key) in rateLimit.ts needs a unique arbiter on key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limits_key ON public.rate_limits(key);

-- Canonical shape keeps RLS enabled with no anon/authenticated policy
-- (deny-by-default; service_role bypasses). Re-assert in case the table
-- was recreated without it.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
