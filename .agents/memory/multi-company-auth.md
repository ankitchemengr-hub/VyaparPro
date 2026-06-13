---
name: Multi-company auth schema
description: How per-company username uniqueness and login routing works in this ERP
---

## Schema

- Dropped global `users_username_unique` constraint.
- Added `users_company_username_uq`: UNIQUE(company_id, username) — scopes usernames per company.
- Added `users_superadmin_username_uq`: UNIQUE(username) WHERE company_id IS NULL — for super_admins only.

**Why:** Multiple companies can each have a user named "admin". The old global UNIQUE prevented this.

## Login routing (auth.ts)

- No `companyId` in request body → super_admin branch: lookup WHERE username=? AND company_id IS NULL.
- `companyId` present → tenant branch: lookup WHERE username=? AND company_id=?.
- Passwords: stored plaintext in dev (checkPassword does plain === hash); never cross-company.

## Audit logging

- `audit_log` table; company_id=0 used as sentinel for super_admin login events (no FK constraint).
- Actions: login_success, login_failure, user_created, password_changed, role_changed, user_activated, user_deactivated, subscription_admin_created.
- GET /api/auth/audit-log is super_admin-only (403 for any other role).

## Migration

File: `migrations/fix_username_unique_per_company.sql`
Must be run on existing DBs; production-schema.sql already has correct indexes for fresh installs.

**How to apply:**
```sql
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_username_unique;
CREATE UNIQUE INDEX IF NOT EXISTS users_company_username_uq ON public.users (company_id, username);
CREATE UNIQUE INDEX IF NOT EXISTS users_superadmin_username_uq ON public.users (username) WHERE company_id IS NULL;
```

## Zod validation

UpdateUserBody and CreateUserBody both enforce `password.min(4)`. Test passwords must be ≥ 4 chars.
