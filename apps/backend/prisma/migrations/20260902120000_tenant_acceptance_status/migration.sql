-- Mandatory tenant acceptance as an explicit state (ADR-165).
--
-- `acceptance_status` is a third axis, independent of `status` (operationally
-- live) and `access_mode` (has a login). The NOT NULL DEFAULT 'NOT_REQUIRED'
-- makes this ALTER safe on a live table AND grandfathers every existing row:
-- existing OWNER_MANAGED tenancies stay 'NOT_REQUIRED' and are invisible to the
-- new field lock, the expiry sweep, and the acceptance invariants. No backfill.

CREATE TYPE "TenantAcceptanceStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'ACCEPTED');

ALTER TABLE "tenants"
  ADD COLUMN "acceptance_status" "TenantAcceptanceStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "tenant_accepted_at" TIMESTAMPTZ(6);

-- The owner "awaiting acceptance" queue and the auto-expiry sweep both filter
-- on this; PENDING is the small, hot slice.
CREATE INDEX "tenants_acceptance_status_pending_idx"
  ON "tenants" ("acceptance_status")
  WHERE "acceptance_status" = 'PENDING';
