-- =============================================================================
-- Migration: Per-Company Username Uniqueness
-- Purpose  : Replace the global UNIQUE(username) constraint with
--            UNIQUE(company_id, username) so the same username (e.g. "admin")
--            can exist in multiple companies without collision.
--
-- Safe to run multiple times (idempotent via IF EXISTS / IF NOT EXISTS guards).
-- Run AFTER fix_multi_company_auth.sql (super_admin must already be correct).
-- =============================================================================

-- STEP 1 — Preview: check for any username that appears more than once globally
-- (not counting super_admin). If this returns rows you must decide which company
-- each duplicate belongs to BEFORE removing the old constraint.
--
-- SELECT username, COUNT(*) AS cnt
-- FROM   public.users
-- WHERE  company_id IS NOT NULL
-- GROUP  BY username
-- HAVING COUNT(*) > 1;


-- STEP 2 — Drop the old global unique constraint.
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_username_unique;


-- STEP 3 — Add the per-company unique index.
-- PostgreSQL treats NULLs as not equal, so rows with company_id = NULL
-- (super_admin) are NOT enforced by this index; they get their own index below.
CREATE UNIQUE INDEX IF NOT EXISTS users_company_username_uq
  ON public.users (company_id, username);


-- STEP 4 — Add a partial unique index for super_admin accounts (company_id IS NULL).
-- Prevents duplicate super_admin usernames while keeping them out of the per-company
-- index (where NULL != NULL would allow unlimited duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS users_superadmin_username_uq
  ON public.users (username)
  WHERE company_id IS NULL;


-- STEP 5 — Verification: after running, both of the following should return 0 rows.

-- Duplicate (company_id, username) among regular users:
--   SELECT company_id, username, COUNT(*) AS cnt
--   FROM   public.users
--   WHERE  company_id IS NOT NULL
--   GROUP  BY company_id, username
--   HAVING COUNT(*) > 1;

-- Duplicate username among super_admin accounts:
--   SELECT username, COUNT(*) AS cnt
--   FROM   public.users
--   WHERE  company_id IS NULL
--   GROUP  BY username
--   HAVING COUNT(*) > 1;
