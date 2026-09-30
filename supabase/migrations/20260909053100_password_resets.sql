-- Password reset tokens table (single-use, short-lived replacement for
-- storing reset tokens on the users table). This allows immediate invalidation
-- without waiting for the users table row update, and supports bulk revocation.

CREATE TABLE IF NOT EXISTS public.password_resets (
  id serial PRIMARY KEY NOT NULL,
  user_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash varchar(256) NOT NULL,
  purpose varchar(50) NOT NULL DEFAULT 'reset' CHECK (purpose IN ('reset')),
  used boolean DEFAULT false NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Index for fast token lookup (single use)
CREATE INDEX IF NOT EXISTS idx_password_resets_token_hash ON public.password_resets(token_hash);
-- Index for cleanup of expired/reset tokens
CREATE INDEX IF NOT EXISTS idx_password_resets_expires_at ON public.password_resets(expires_at);
-- Index for user-scoped queries (cleanup)
CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON public.password_resets(user_id);

-- Enable RLS: service_role can manage all; anon/authenticated denied
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Service role (admin operations) can do everything
DROP POLICY IF EXISTS "service_role_full_access" ON public.password_resets;
CREATE POLICY "service_role_full_access" ON public.password_resets
  USING (true)
  WITH CHECK (true);

-- Anon and authenticated users denied by default (sensitive data)