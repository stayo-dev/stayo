-- Migration: tenant_status_cancelled_expired
--
-- INVITED → EXPIRED : system-expired (never activated, invite TTL passed)
-- INVITED → CANCELLED : owner explicitly cancelled the invitation
--
-- LEFT remains strictly for previously-ACTIVE tenants who left.

ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- Backfill: any INVITED tenant whose invitation_expires_at has passed
-- should be EXPIRED, not LEFT (LEFT implies they were once ACTIVE).
-- Only correct data created before this migration where expiry ran and
-- incorrectly set status=LEFT on a tenant that was always INVITED.
-- We do NOT auto-migrate existing LEFT rows because LEFT is also used
-- for truly departed active tenants. This is a forward-only fix.

-- No data backfill needed — new code paths write EXPIRED/CANCELLED going forward.
