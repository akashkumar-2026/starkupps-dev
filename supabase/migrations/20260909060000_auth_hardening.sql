-- Auth hardening: persistent rate limiting, concurrent session limits, CSRF tokens, device fingerprinting
-- Run with: npx supabase migration up

-- ============================================================
-- 1. PERSISTENT RATE LIMITING (replaces in-memory Map)
-- ============================================================
-- Canonical shape is public.rate_limits(key, count, reset_at) — created by
-- 20250904120013 and used by server/_core/rateLimit.ts. (An earlier revision
-- of this section defined a different shape whose indexes referenced
-- nonexistent columns and would abort the push; it was removed. See
-- 20260925000000_rls_repair.sql for the convergence repair.)
SELECT 1;

-- ============================================================
-- 2. CSRF TOKEN TRACKING
-- ============================================================
CREATE TABLE IF NOT EXISTS public.csrf_tokens (
  id serial PRIMARY KEY NOT NULL,
  user_id integer REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash varchar(256) NOT NULL,
  audience varchar(20) NOT NULL CHECK (audience IN ('admin', 'pos')),
  used boolean DEFAULT false NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csrf_tokens_token_hash ON public.csrf_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_csrf_tokens_user_id ON public.csrf_tokens(user_id);

-- ============================================================
-- 3. DEVICE FINGERPRINTING FOR SESSIONS
-- ============================================================
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS device_fingerprint varchar(256);
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS concurrent_slot integer;

-- ============================================================
-- 4. CONCURRENT SESSION LIMIT TRACKING
-- ============================================================
CREATE TABLE IF NOT EXISTS public.session_limits (
  id serial PRIMARY KEY NOT NULL,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  audience varchar(20) NOT NULL CHECK (audience IN ('admin', 'pos')),
  active_count integer NOT NULL DEFAULT 0,
  max_allowed integer NOT NULL DEFAULT 5,
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_limits_user_audience ON public.session_limits(user_id, audience);

-- ============================================================
-- 5. AUDIT LOG IMPROVEMENTS
-- ============================================================
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS ip_address inet;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS success boolean;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS metadata jsonb;

-- ============================================================
-- 6. USERS TABLE HARDENING
-- ============================================================
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status varchar(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED', 'LOCKED'));
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_alg varchar(20) DEFAULT 'argon2id';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_updated_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS refresh_token_version integer DEFAULT 0;

-- ============================================================
-- 7. INDEXES FOR PERFORMANCE
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON public.audit_log("actorUserId", "createdAt");
CREATE INDEX IF NOT EXISTS idx_audit_log_action_created ON public.audit_log(action, "createdAt");

-- ============================================================
-- 8. CLEANUP FUNCTION (for scheduled job)
-- ============================================================
-- NOTE: cleanup targets the canonical (key/count/reset_at) shape.
CREATE OR REPLACE FUNCTION public.cleanup_expired_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM public.rate_limits WHERE reset_at < now() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;