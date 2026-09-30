-- ============================================================================
-- Auth hardening: real device sessions ("Remember on this device")
-- ============================================================================
-- Before this migration `public.sessions` was write-only bookkeeping: login
-- stored the hash of a random token that was never handed to the client, so
-- no refresh exchange existed, no session was ever validated server-side, and
-- rows were never cleaned up. The only operative credential was the 7-day JWT
-- plus `users.sessionVersion`, which cannot revoke a single device.
--
-- This migration turns `sessions` into the authoritative per-device session
-- store:
--   * `token_hash`   — SHA-256 of the opaque refresh token (never the token)
--   * `family_id`    — rotation family; reuse of a rotated token revokes it
--   * `remember`     — persistent (30d) vs session-only device session
--   * `replaced_by`  — rotation chain, enables reuse detection
--   * device metadata for the "Active devices" admin view
--
-- Sessions are also linked into the access JWT via a `sid` claim so that a
-- single device session can be revoked without a global version bump.
-- ============================================================================

-- ── 1. Session columns ─────────────────────────────────────────────────────
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS family_id uuid;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS remember boolean NOT NULL DEFAULT false;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS revoked_reason varchar(64);
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS replaced_by integer REFERENCES public.sessions(id) ON DELETE SET NULL;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS device_label varchar(160);
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS rotated_at timestamptz;

-- Every session created after this migration belongs to a family. Legacy rows
-- (written by the old dead-code path) keep NULL and are handled as
-- "not refreshable" rather than failing the NOT NULL below.
UPDATE public.sessions SET family_id = gen_random_uuid()::uuid WHERE family_id IS NULL;

DO $$
BEGIN
  ALTER TABLE public.sessions ALTER COLUMN family_id SET NOT NULL;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'sessions.family_id left nullable (duplicate NULLs or permission denied)';
END
$$;

-- ── 2. Indexes for the auth hot path ────────────────────────────────────────
-- Session validation on every authenticated request:
--   lookup by (user_id, audience) among live rows only.
CREATE INDEX IF NOT EXISTS idx_sessions_user_audience_active
  ON public.sessions(user_id, audience)
  WHERE revoked_at IS NULL;

-- Rotation / reuse detection resolves a token hash to its row.
-- idx_sessions_token_hash_unique already exists (20260909053200) and covers
-- this; the older non-unique idx_sessions_token_hash is fully shadowed by it.
DROP INDEX IF EXISTS public.idx_sessions_token_hash;

-- Reuse detection revokes a whole family in one statement.
CREATE INDEX IF NOT EXISTS idx_sessions_family_id ON public.sessions(family_id);

-- Cleanup scans (H6): expired or long-revoked rows.
CREATE INDEX IF NOT EXISTS idx_sessions_revoked_at ON public.sessions(revoked_at);

-- ── 3. User email integrity (M3) ───────────────────────────────────────────
-- `users.email` was nullable with no uniqueness and login used `.maybeSingle()`,
-- which THROWS on >1 row — so a duplicate email turned login into a 500.
-- Normalize case and enforce uniqueness on lower(email) for non-null rows.
-- Report (and fail loudly, rather than silently) any duplicates that would
-- block the unique index.
DO $$
DECLARE dupes text;
BEGIN
  SELECT string_agg(d, ', ') INTO dupes FROM (
    SELECT lower("email") || ' x' || count(*) AS d
    FROM public.users
    WHERE "email" IS NOT NULL AND btrim("email") <> ''
    GROUP BY lower("email") HAVING count(*) > 1
  ) s;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot enforce unique lower(email) on public.users — duplicates found: %. '
      'Resolve duplicates manually before re-running this migration.', dupes;
  END IF;
END
$$;

-- Case-insensitive uniqueness: login lowercases its input, so two accounts
-- differing only in case would otherwise both match the same query.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
  ON public.users(lower("email"))
  WHERE "email" IS NOT NULL AND btrim("email") <> '';

-- ── 4. Retire pre-migration session rows ────────────────────────────────────
-- Rows created by the old code path hold the hash of a random token that was
-- never sent to any client, so they can never be refreshed or resolved. Mark
-- them revoked so they do not appear as phantom "devices" in the admin
-- sessions view. A no-op on a fresh database.
UPDATE public.sessions
SET revoked_at = COALESCE(revoked_at, now()),
    revoked_reason = COALESCE(revoked_reason, 'legacy_no_issued_token')
WHERE device_label IS NULL AND revoked_at IS NULL;

-- ── 5. Cleanup (H6) ─────────────────────────────────────────────────────────
-- `cleanupExpiredSessions()` existed in application code but was never
-- invoked, so `sessions` grew without bound. This is the DB-side equivalent,
-- safe to call from a scheduler (pg_cron) or the in-process interval.
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  removed bigint;
BEGIN
  DELETE FROM public.sessions
  WHERE expires_at < now() - INTERVAL '7 days'
     OR (revoked_at IS NOT NULL AND revoked_at < now() - INTERVAL '7 days');
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$$;

-- Reset tokens were never pruned either. `used_at` distinguishes a spent
-- token from an old unused one.
ALTER TABLE public.password_resets ADD COLUMN IF NOT EXISTS used_at timestamptz;

CREATE OR REPLACE FUNCTION public.cleanup_expired_password_resets()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  removed bigint;
BEGIN
  IF to_regclass('public.password_resets') IS NULL THEN
    RETURN 0;
  END IF;
  DELETE FROM public.password_resets
  WHERE expires_at < now() - INTERVAL '1 day'
     OR (used = true AND created_at < now() - INTERVAL '1 day');
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_sessions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_expired_sessions() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_sessions() TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_expired_password_resets() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_expired_password_resets() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_password_resets() TO service_role;
