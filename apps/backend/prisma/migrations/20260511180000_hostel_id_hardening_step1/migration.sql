-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION: hostel_id hardening – Step 1 (additive + backfill)
-- Zero-downtime: adds nullable columns first, backfills from related tables.
-- Step 2 (NOT NULL enforcement) runs in a separate migration after verification.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. tenant_advance_ledger.hostel_id ───────────────────────────────────────
-- No hostel_id existed before. Add as nullable, backfill from tenant.hostel_id.
ALTER TABLE tenant_advance_ledger
  ADD COLUMN IF NOT EXISTS hostel_id UUID;

UPDATE tenant_advance_ledger tal
SET hostel_id = t.hostel_id
FROM tenants t
WHERE tal.tenant_id = t.id
  AND tal.hostel_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_tal_hostel_id
  ON tenant_advance_ledger (hostel_id);

CREATE INDEX IF NOT EXISTS idx_tal_tenant_hostel
  ON tenant_advance_ledger (tenant_id, hostel_id);

-- ── 2. payment_attempts.hostel_id ────────────────────────────────────────────
-- Column already exists (nullable). Backfill from rent_obligations via obligation_id.
UPDATE payment_attempts pa
SET hostel_id = ro.hostel_id
FROM rent_obligations ro
WHERE pa.obligation_id = ro.id
  AND pa.hostel_id IS NULL;

-- ── 3. whatsapp_logs.hostel_id ───────────────────────────────────────────────
-- Column already exists (nullable). Backfill from rent_obligations via obligation_id.
UPDATE whatsapp_logs wl
SET hostel_id = ro.hostel_id
FROM rent_obligations ro
WHERE wl.obligation_id = ro.id
  AND wl.hostel_id IS NULL;

-- For rows without obligation_id, try to derive from tenant.hostel_id.
UPDATE whatsapp_logs wl
SET hostel_id = t.hostel_id
FROM tenants t
WHERE wl.tenant_id = t.id
  AND wl.hostel_id IS NULL;
