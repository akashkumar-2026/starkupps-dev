-- Prevent duplicate server-side session records for the same opaque token.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash_unique
  ON public.sessions(token_hash);
