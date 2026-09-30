-- ============================================================================
-- Permission: finance.taxes
-- ============================================================================
-- `finance.taxes.create/update/remove` were gated on `finance.refund`, which is
-- the wrong capability: a role permitted to issue refunds could rewrite tax
-- rates, and a role permitted to manage taxes was blocked. Tax configuration is
-- pricing/legal-sensitive, so it is granted to the owner only.
--
-- Enforcement lives in `shared/permissions.ts` (ROLE_PERMISSIONS), which both
-- the client and `server/db.ts:hasPermission` use. This migration keeps the
-- database catalog in step so the Staff -> Roles matrix UI agrees with what the
-- server actually enforces.
-- ============================================================================

INSERT INTO public.workforce_permissions (key, description, category)
SELECT 'finance.taxes', 'Create, update and remove tax rates', 'Finance'
WHERE NOT EXISTS (SELECT 1 FROM public.workforce_permissions p WHERE p.key = 'finance.taxes');

-- Grant to the owner-equivalent system role only. Matches ROLE_PERMISSIONS,
-- where `finance.taxes` appears in the owner list and nowhere else.
--
-- Two things this must get right, both learned the hard way:
--   * The catalog's owner-equivalent role is `super_admin` ("Super Admin");
--     there is no row with slug `owner`, so a lookup keyed on that silently
--     grants nothing.
--   * `workforce_role_permissions` uses camelCase columns. PL/pgSQL folds
--     unquoted identifiers to lowercase, so they must be double-quoted.
DO $$
DECLARE
  owner_role_id integer;
BEGIN
  SELECT id INTO owner_role_id
    FROM public.workforce_roles
   WHERE slug IN ('owner', 'super_admin')
   ORDER BY (slug = 'owner') DESC
   LIMIT 1;

  IF owner_role_id IS NULL THEN
    RAISE EXCEPTION
      'No owner-equivalent role found in public.workforce_roles (looked for slug owner/super_admin). '
      'Grant finance.taxes to the right role manually before completing this migration.';
  END IF;

  INSERT INTO public.workforce_role_permissions ("roleId", "permissionKey")
  SELECT owner_role_id, 'finance.taxes'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.workforce_role_permissions rp
     WHERE rp."roleId" = owner_role_id AND rp."permissionKey" = 'finance.taxes'
  );
END
$$;