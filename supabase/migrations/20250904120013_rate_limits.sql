-- Persistent rate limiting (survives restart / scales)
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key varchar(200) PRIMARY KEY,
  count integer NOT NULL DEFAULT 1,
  reset_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON public.rate_limits(reset_at);
-- No RLS: service_role only
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- deny anon (no policies => service_role bypass only)
