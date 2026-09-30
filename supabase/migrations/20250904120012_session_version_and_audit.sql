-- Session revocation: version bump invalidates old JWTs
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "sessionVersion" integer DEFAULT 0 NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_openid ON public.users("openId");

-- Audit helpful index for auth events
CREATE INDEX IF NOT EXISTS idx_audit_action ON public.audit_log(action) WHERE action IN ('login_success','login_failure','logout','password_changed','password_reset_requested');

-- Outlet scope fix: no schema change, logic fix in app (empty scope => deny)
-- Ensure staff status values are constrained (if not already)
DO $$ BEGIN
  BEGIN
    ALTER TABLE public.staff ADD CONSTRAINT staff_status_check CHECK (status IN ('active','on_leave','pending','suspended','inactive','terminated'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
