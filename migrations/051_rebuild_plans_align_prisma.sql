-- Migration 051: Rebuild plans table to match Prisma schema
--
-- Root cause: Migration 046 created plans with a UUID auto-generated PK and a
-- separate `code` TEXT column, plus `price_paise` and a JSONB `features` array.
-- The Prisma model (and the entire billing/enforcement codebase) expects:
--   plans.id        TEXT PRIMARY KEY  (values: "FREE", "STARTER", "GROWTH", ...)
--   plans.price_inr INTEGER           (same unit as price_paise — rename only)
--   plans.automation / messaging / multi_hostel / analytics  BOOLEAN
--
-- owner_subscriptions.plan_id and owner_invoices.plan_id must change from UUID to TEXT.
-- payment_attempts.invoice_id references owner_invoices(id) — preserved throughout.
--
-- Safety guarantees:
--   • owner_subscriptions data is preserved via a temp-table backup + remap.
--   • owner_invoices rows are preserved; only plan_id column type changes (set NULL).
--   • payment_attempts are NOT touched (FK to owner_invoices is dropped + re-added).
--   • All steps are wrapped in a transaction.

BEGIN;

-- ── Step 1: Drop FK / CHECK constraints that reference the tables we're altering ──

ALTER TABLE owner_subscriptions
  DROP CONSTRAINT IF EXISTS owner_subscriptions_plan_id_fkey;

ALTER TABLE owner_invoices
  DROP CONSTRAINT IF EXISTS owner_invoices_plan_id_fkey;

ALTER TABLE payment_attempts
  DROP CONSTRAINT IF EXISTS payment_attempts_invoice_id_fkey;

-- The XOR check (obligation_id XOR invoice_id) is preserved; we are NOT nulling invoice_ids.

-- ── Step 2: Back up subscription rows (for remapping plan codes) ──────────────

CREATE TEMP TABLE IF NOT EXISTS _sub_backup AS
SELECT
    os.owner_id,
    COALESCE(p.code, 'STARTER') AS plan_code,
    os.status,
    os.start_date,
    os.end_date,
    os.auto_renew
FROM owner_subscriptions os
LEFT JOIN plans p ON p.id = os.plan_id;

-- ── Step 3: Clear subscriptions (will be restored in Step 9) ─────────────────

TRUNCATE owner_subscriptions;

-- ── Step 4: Change owner_subscriptions.plan_id from UUID to TEXT ─────────────

ALTER TABLE owner_subscriptions
  ALTER COLUMN plan_id TYPE TEXT USING 'FREE';

ALTER TABLE owner_subscriptions
  ALTER COLUMN plan_id SET DEFAULT 'FREE';

-- ── Step 5: Change owner_invoices.plan_id from UUID to TEXT ──────────────────
-- Set NULL — old UUID values cannot be mapped to new TEXT plan IDs.
-- Invoice records and their payment_attempt references are preserved.

UPDATE owner_invoices SET plan_id = NULL;

ALTER TABLE owner_invoices
  ALTER COLUMN plan_id TYPE TEXT USING NULL;

-- ── Step 6: Remove status CHECK on owner_subscriptions (app enforces this) ───
-- The old CHECK allowed only: FREE, ACTIVE, PAST_DUE, EXPIRED, CANCELLED.
-- The app also uses GRACE and LIMITED, so the constraint was already incomplete.

ALTER TABLE owner_subscriptions
  DROP CONSTRAINT IF EXISTS owner_subscriptions_status_check;

-- ── Step 7: Drop and recreate the plans table ─────────────────────────────────
-- Now that all FK references from owner_subscriptions and owner_invoices have been
-- changed to TEXT and nulled, plans(id) is no longer referenced by any FK.

DROP TABLE IF EXISTS plans CASCADE;

CREATE TABLE plans (
    id            TEXT        PRIMARY KEY,
    name          TEXT        NOT NULL,
    price_inr     INTEGER     NOT NULL DEFAULT 0,
    tenant_limit  INTEGER     NOT NULL DEFAULT 0,
    hostel_limit  INTEGER     NOT NULL DEFAULT 0,
    automation    BOOLEAN     NOT NULL DEFAULT FALSE,
    messaging     BOOLEAN     NOT NULL DEFAULT FALSE,
    multi_hostel  BOOLEAN     NOT NULL DEFAULT FALSE,
    analytics     BOOLEAN     NOT NULL DEFAULT FALSE,
    is_custom     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN plans.tenant_limit IS '0 = unlimited';
COMMENT ON COLUMN plans.hostel_limit IS '0 = unlimited';

-- ── Step 8: Seed plans ────────────────────────────────────────────────────────

INSERT INTO plans (id, name, price_inr, tenant_limit, hostel_limit, automation, messaging, multi_hostel, analytics)
VALUES
  ('FREE',     'Free',     0,      10,  1,  FALSE, FALSE, FALSE, FALSE),
  ('STARTER',  'Starter',  49900,  25,  1,  FALSE, FALSE, FALSE, FALSE),
  ('GROWTH',   'Growth',   149900, 100, 3,  TRUE,  TRUE,  FALSE, TRUE),
  ('BUSINESS', 'Business', 399900, 500, 10, TRUE,  TRUE,  TRUE,  TRUE),
  ('SCALE',    'Scale',    999900, 0,   0,  TRUE,  TRUE,  TRUE,  TRUE)
ON CONFLICT (id) DO UPDATE SET
    name          = EXCLUDED.name,
    price_inr     = EXCLUDED.price_inr,
    tenant_limit  = EXCLUDED.tenant_limit,
    hostel_limit  = EXCLUDED.hostel_limit,
    automation    = EXCLUDED.automation,
    messaging     = EXCLUDED.messaging,
    multi_hostel  = EXCLUDED.multi_hostel,
    analytics     = EXCLUDED.analytics;

-- ── Step 9: Re-add FK constraints ─────────────────────────────────────────────

ALTER TABLE owner_subscriptions
  ADD CONSTRAINT owner_subscriptions_plan_id_fkey
  FOREIGN KEY (plan_id) REFERENCES plans(id);

ALTER TABLE owner_invoices
  ADD CONSTRAINT owner_invoices_plan_id_fkey
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL;

ALTER TABLE payment_attempts
  ADD CONSTRAINT payment_attempts_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES owner_invoices(id) ON DELETE SET NULL;

-- ── Step 10: Restore owner subscriptions ──────────────────────────────────────

INSERT INTO owner_subscriptions (owner_id, plan_id, status, start_date, end_date, auto_renew)
SELECT
    b.owner_id,
    CASE b.plan_code
        WHEN 'PRO'      THEN 'GROWTH'
        WHEN 'BUSINESS' THEN 'BUSINESS'
        WHEN 'STARTER'  THEN 'STARTER'
        WHEN 'GROWTH'   THEN 'GROWTH'
        WHEN 'SCALE'    THEN 'SCALE'
        ELSE 'FREE'
    END AS plan_id,
    b.status,
    b.start_date,
    b.end_date,
    b.auto_renew
FROM _sub_backup b;

-- Ensure every OWNER profile has a subscription (catch any not in backup)
INSERT INTO owner_subscriptions (owner_id, plan_id, status, start_date)
SELECT p.id, 'FREE', 'FREE', CURRENT_DATE
FROM profiles p
WHERE p.role = 'OWNER'
  AND NOT EXISTS (
    SELECT 1 FROM owner_subscriptions os WHERE os.owner_id = p.id
  );

COMMIT;
