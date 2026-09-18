-- 085_manager_role.sql
--
-- Super Admin -> Manager -> Hostel assignment system.
--
-- Adds a MANAGER role scoped below ADMIN: a Super Admin creates managers,
-- grants them a subset of platform-admin permissions, and assigns them a
-- subset of hostels. Enforcement lives in application code
-- (manager-authorization.ts); this migration only adds the tables/columns
-- that state lives in.
--
-- Apply via the Supabase SQL editor or psql.

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MANAGER';

DO $$ BEGIN
  CREATE TYPE "ManagerStatus" AS ENUM ('PENDING_INVITATION', 'ACTIVE', 'SUSPENDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ManagerPermission" AS ENUM (
    'MANAGE_LEADS',
    'MANAGE_OWNERS',
    'MANAGE_HOSTELS',
    'MANAGE_ONBOARDING',
    'VIEW_REVENUE_ANALYTICS',
    'MANAGE_SUBSCRIPTIONS',
    'SUPPORT_REPORTS_BUGS',
    'MANAGE_BROADCASTS',
    'MANAGE_SETTINGS'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS manager_profiles (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id         UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  status             "ManagerStatus" NOT NULL DEFAULT 'PENDING_INVITATION',
  invited_by         UUID,
  phone_verified_at  TIMESTAMPTZ,
  activated_at       TIMESTAMPTZ,
  suspended_at       TIMESTAMPTZ,
  suspended_by       UUID,
  suspended_reason   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS manager_permission_grants (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_profile_id  UUID NOT NULL REFERENCES manager_profiles(id) ON DELETE CASCADE,
  permission          "ManagerPermission" NOT NULL,
  granted_by          UUID,
  granted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (manager_profile_id, permission)
);

CREATE TABLE IF NOT EXISTS manager_hostel_assignments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_profile_id  UUID NOT NULL REFERENCES manager_profiles(id) ON DELETE CASCADE,
  hostel_id           UUID NOT NULL REFERENCES hostels(id) ON DELETE CASCADE,
  assigned_by         UUID,
  assigned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at       TIMESTAMPTZ,
  unassigned_by       UUID
);

CREATE INDEX IF NOT EXISTS idx_manager_hostel_assignments_manager
  ON manager_hostel_assignments (manager_profile_id, unassigned_at);

CREATE INDEX IF NOT EXISTS idx_manager_hostel_assignments_hostel
  ON manager_hostel_assignments (hostel_id, unassigned_at);

-- At most one ACTIVE (unassigned_at IS NULL) manager per hostel. Reassigning
-- a hostel must close the old row in the same transaction that opens the
-- new one — the service layer does this, this index is the DB-level
-- backstop. Same technique as tenants_one_live_tenancy_per_profile.
CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_hostel_assignments_one_active
  ON manager_hostel_assignments (hostel_id)
  WHERE unassigned_at IS NULL;

-- Supports the Super Admin activity feed's "filter by manager" query
-- (activity_logs already carries the hostel in metadata->>'hostel_id',
-- see migrations/082_activity_logs_hostel_index.sql — no column added here).
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_ts
  ON activity_logs (user_id, timestamp DESC);
