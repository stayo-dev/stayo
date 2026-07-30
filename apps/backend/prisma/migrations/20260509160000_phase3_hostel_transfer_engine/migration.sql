-- Phase 3: Hostel Transfer Engine
-- Purpose: Support operationally safe tenant hostel transfers
--          with full audit trail and financial immutability preservation.

-- ── TenantTransferLog ────────────────────────────────────────────────────────
-- Records every hostel transfer with before/after context.
-- Immutable audit trail — rows are never updated or deleted.
CREATE TABLE IF NOT EXISTS tenant_transfer_logs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL,
  from_hostel_id    UUID        NOT NULL,
  to_hostel_id      UUID        NOT NULL,
  old_allocation_id UUID,
  new_allocation_id UUID,
  transferred_by    UUID        NOT NULL,
  transferred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason            TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for operational queries
CREATE INDEX IF NOT EXISTS idx_transfer_logs_tenant    ON tenant_transfer_logs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_transfer_logs_from      ON tenant_transfer_logs (from_hostel_id);
CREATE INDEX IF NOT EXISTS idx_transfer_logs_to        ON tenant_transfer_logs (to_hostel_id);
CREATE INDEX IF NOT EXISTS idx_transfer_logs_at        ON tenant_transfer_logs (transferred_at);

-- ── Phase 5: Hostel Invariant Validation Log ─────────────────────────────────
-- Records results of nightly invariant checks for operational health monitoring.
CREATE TABLE IF NOT EXISTS hostel_invariant_checks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  check_type        TEXT        NOT NULL,
  entity_type       TEXT        NOT NULL,
  entity_id         UUID,
  expected_value    TEXT,
  actual_value      TEXT,
  is_valid          BOOLEAN     NOT NULL DEFAULT true,
  details           JSONB,
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invariant_checks_type   ON hostel_invariant_checks (check_type);
CREATE INDEX IF NOT EXISTS idx_invariant_checks_valid  ON hostel_invariant_checks (is_valid) WHERE is_valid = false;
CREATE INDEX IF NOT EXISTS idx_invariant_checks_at     ON hostel_invariant_checks (checked_at);
