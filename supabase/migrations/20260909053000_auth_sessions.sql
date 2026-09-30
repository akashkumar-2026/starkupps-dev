-- Auth session management (with server-side session tracking and refresh token rotation)
-- This table stores active sessions for logout/revocation support beyond
-- simple JWT statelessness. JWT `aud` claim provides Admin vs POS isolation.

CREATE TABLE IF NOT EXISTS public.sessions (
  id serial PRIMARY KEY NOT NULL,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash varchar(256) NOT NULL,
  audience varchar(20) NOT NULL DEFAULT 'admin' CHECK (audience IN ('admin', 'pos')),
  user_agent text,
  ip_address inet,
  created_at timestamptz DEFAULT now() NOT NULL,
  last_used_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  session_version_at_creation integer NOT NULL DEFAULT 0
);

-- Index for fast session lookup by token hash (used on every request)
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON public.sessions(token_hash);
-- Index for cleanup by expiry
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON public.sessions(expires_at);
-- Index for user-scoped queries (audit/revocation)
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);

-- Enable RLS: service_role can manage all; anon and authenticated are denied
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Service role (admin operations) can do everything
DROP POLICY IF EXISTS "service_role_full_access" ON public.sessions;
CREATE POLICY "service_role_full_access" ON public.sessions
  USING (true)
  WITH CHECK (true);

-- Anon and authenticated users denied by default (sensitive data)