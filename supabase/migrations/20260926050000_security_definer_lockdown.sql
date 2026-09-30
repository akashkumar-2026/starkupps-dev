-- Security hardening: lock down SECURITY DEFINER functions that were callable
-- by anonymous PostgREST clients.
--
-- Findings (admin production audit F-02/F-03):
--   * `cleanup_expired_rate_limits()` is SECURITY DEFINER with no `search_path`
--     and default EXECUTE to PUBLIC. Any visitor holding the anon key can call
--     it via /rest/v1/rpc/... to purge rate-limit rows, defeating login
--     throttling and enabling brute force / DoS.
--   * `is_member_of_outlet(int,int)` / `is_active_staff(int)` are SECURITY
--     DEFINER and callable by anon, allowing staff/outlet membership
--     enumeration while bypassing RLS on `staff`/`outlet_staff`.
--
-- Target: only `service_role` may execute these helpers. If a future RLS policy
-- needs them for `authenticated`, grant EXECUTE explicitly in that migration.
--
-- Idempotent: safe to re-run.

-- 1. Re-define the cleanup function with a safe, fixed search_path.
CREATE OR REPLACE FUNCTION public.cleanup_expired_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.rate_limits WHERE reset_at < now() - INTERVAL '1 hour';
END;
$$;

-- 2. Remove default PUBLIC execute and revoke from the API roles.
REVOKE ALL ON FUNCTION public.cleanup_expired_rate_limits() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_expired_rate_limits() FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.is_member_of_outlet(int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_member_of_outlet(int, int) FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.is_active_staff(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_staff(int) FROM anon, authenticated;

-- 3. Keep server-side access available.
GRANT EXECUTE ON FUNCTION public.cleanup_expired_rate_limits() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_member_of_outlet(int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_active_staff(int) TO service_role;
