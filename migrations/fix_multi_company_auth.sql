-- =============================================================================
-- Migration: Fix Multi-Company Authentication
-- Purpose  : Repair existing databases that have company-unbound user accounts
--            produced by the old bootstrap (role "admin", company_id NULL).
--            Safe to run multiple times (idempotent).
-- =============================================================================

-- STEP 1 — Upgrade the bootstrap "admin" user to "super_admin" if it was
-- created with the old role. The platform super_admin must have company_id NULL
-- (cross-tenant). If this row already has role "super_admin", this is a no-op.
UPDATE public.users
SET    role       = 'super_admin',
       name       = COALESCE(NULLIF(name, ''), 'Super Administrator'),
       company_id = NULL
WHERE  username   = 'admin'
  AND  role       != 'super_admin';

-- STEP 2 — Deactivate any non-super_admin user whose company_id is NULL.
-- These orphan accounts cannot access any data (getCompanyId() throws 403).
-- Deactivating prevents them from logging in with a confusing failure and
-- gives the operator a clear list of accounts to fix (assign to a company).
-- Review the query below BEFORE running; adjust if your deployment differs.
--
-- To preview orphan accounts first (read-only):
--   SELECT id, username, role, name, is_active
--   FROM   public.users
--   WHERE  role != 'super_admin'
--     AND  company_id IS NULL;
--
UPDATE public.users
SET    is_active = false
WHERE  role      != 'super_admin'
  AND  company_id IS NULL
  AND  username   != 'admin';   -- skip the bootstrap admin (handled above)

-- STEP 3 — Reassign an orphan user to a company (run per user as needed).
-- Replace $USERNAME and $COMPANY_ID with the actual values.
-- Example:
--   UPDATE public.users
--   SET    company_id = 3,
--          is_active  = true
--   WHERE  username   = 'old_admin_user';

-- STEP 4 — Verify: after running, no non-super_admin user should have a
-- NULL company_id and be active. This query should return 0 rows:
--   SELECT id, username, role, name, company_id, is_active
--   FROM   public.users
--   WHERE  role      != 'super_admin'
--     AND  company_id IS NULL
--     AND  is_active  = true;
