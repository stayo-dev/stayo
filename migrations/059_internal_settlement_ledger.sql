-- ============================================================
-- 059 Internal Settlement & Financial Operations System
-- ============================================================
-- Greenfield additive migration. NO mutation of existing
-- payments, payment_attempts, rent_obligations, receipts, or
-- ownerInvoice tables. All FKs into existing tables are
-- nullable / additive.
--
-- Tables introduced:
--   1. owner_settlement_ledger       (append-only liability ledger)
--   2. settlement_batches            (manual payout batches)
--   3. settlement_batch_items        (per-owner per-hostel payout rows)
--   4. financial_reconciliation_issues (ledger-level drift)
--   5. admin_financial_audit_log     (HMS-internal admin trail)
--
-- All amounts: DECIMAL(14,2) INR, no FX.
-- All timestamps: TIMESTAMPTZ.
-- All tables: append-only by service contract (no DELETE allowed).
-- ============================================================

-- ------------------------------------------------------------
-- 1. owner_settlement_ledger
-- ------------------------------------------------------------
-- Append-only. Each row is one CREDIT or DEBIT against an
-- (owner_id, hostel_id) balance. Service is responsible for
-- computing balance_after under a row-lock on the latest row.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS owner_settlement_ledger (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id             UUID         NOT NULL,
  hostel_id            UUID         NOT NULL,

  -- Source linkage (polymorphic — exactly one of these populated by service)
  payment_id           UUID         NULL,
  settlement_batch_id  UUID         NULL,
  batch_item_id        UUID         NULL,

  -- Entry semantics
  entry_type           VARCHAR(40)  NOT NULL,
  direction            CHAR(1)      NOT NULL,
  amount               DECIMAL(14,2) NOT NULL,
  balance_after        DECIMAL(14,2) NOT NULL,
  currency             VARCHAR(3)   NOT NULL DEFAULT 'INR',

  -- Settlement state of this specific entry
  -- For CREDIT rows: PENDING_SETTLEMENT until a matching DEBIT lands.
  -- For DEBIT rows: SETTLED on insert (DEBIT IS the settlement).
  settlement_status    VARCHAR(30)  NOT NULL DEFAULT 'PENDING_SETTLEMENT',
  settled_at           TIMESTAMPTZ  NULL,

  -- Idempotency / provenance
  idempotency_key      TEXT         NOT NULL,
  reference_type       VARCHAR(40)  NULL,
  reference_id         TEXT         NULL,
  metadata             JSONB        NOT NULL DEFAULT '{}'::jsonb,

  -- Audit
  created_by           UUID         NULL,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT osl_amount_positive       CHECK (amount > 0),
  CONSTRAINT osl_direction_valid       CHECK (direction IN ('C','D')),
  CONSTRAINT osl_currency_inr          CHECK (currency = 'INR'),
  CONSTRAINT osl_entry_type_valid      CHECK (entry_type IN (
    'CREDIT_COLLECTION',
    'DEBIT_PAYOUT',
    'ADJUSTMENT_CREDIT',
    'ADJUSTMENT_DEBIT',
    'REFUND_DEBIT',
    'REVERSAL_CREDIT'
  )),
  CONSTRAINT osl_settlement_status_valid CHECK (settlement_status IN (
    'PENDING_SETTLEMENT',
    'SETTLED',
    'VOIDED'
  )),
  CONSTRAINT osl_direction_matches_type CHECK (
       (direction = 'C' AND entry_type IN ('CREDIT_COLLECTION','ADJUSTMENT_CREDIT','REVERSAL_CREDIT'))
    OR (direction = 'D' AND entry_type IN ('DEBIT_PAYOUT','ADJUSTMENT_DEBIT','REFUND_DEBIT'))
  ),
  CONSTRAINT osl_credit_collection_has_payment CHECK (
    entry_type <> 'CREDIT_COLLECTION' OR payment_id IS NOT NULL
  ),
  CONSTRAINT osl_debit_payout_has_batch_item CHECK (
    entry_type <> 'DEBIT_PAYOUT' OR batch_item_id IS NOT NULL
  ),
  CONSTRAINT osl_idempotency_key_nonempty CHECK (length(idempotency_key) > 0)
);

-- Hard idempotency: never two ledger rows with the same logical key.
CREATE UNIQUE INDEX IF NOT EXISTS udx_osl_idempotency_key
  ON owner_settlement_ledger (idempotency_key);

-- Exactly one CREDIT_COLLECTION per payment_id (partial unique).
CREATE UNIQUE INDEX IF NOT EXISTS udx_osl_one_credit_per_payment
  ON owner_settlement_ledger (payment_id)
  WHERE entry_type = 'CREDIT_COLLECTION';

-- Exactly one DEBIT_PAYOUT per batch_item_id (partial unique).
CREATE UNIQUE INDEX IF NOT EXISTS udx_osl_one_debit_per_batch_item
  ON owner_settlement_ledger (batch_item_id)
  WHERE entry_type = 'DEBIT_PAYOUT';

-- Hot-path read indexes
CREATE INDEX IF NOT EXISTS idx_osl_owner_hostel_created
  ON owner_settlement_ledger (owner_id, hostel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_osl_owner_status
  ON owner_settlement_ledger (owner_id, settlement_status);

CREATE INDEX IF NOT EXISTS idx_osl_hostel_status
  ON owner_settlement_ledger (hostel_id, settlement_status);

CREATE INDEX IF NOT EXISTS idx_osl_settlement_batch
  ON owner_settlement_ledger (settlement_batch_id)
  WHERE settlement_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_osl_payment
  ON owner_settlement_ledger (payment_id)
  WHERE payment_id IS NOT NULL;

-- Foreign keys (additive; nullable on referenced rows to avoid
-- forcing pre-existing payments to have ledger rows).
ALTER TABLE owner_settlement_ledger
  ADD CONSTRAINT fk_osl_payment
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT;

-- ------------------------------------------------------------
-- 2. settlement_batches
-- ------------------------------------------------------------
-- A batch is a unit of admin work: "today we paid owners X, Y, Z".
-- Append-only in spirit: rows are never deleted, only state-machine
-- transitioned. State machine:
--   DRAFT -> APPROVED -> PROCESSING -> COMPLETED
--                                   -> PARTIALLY_FAILED
--                                   -> FAILED
--   DRAFT -> CANCELLED  (only from DRAFT or APPROVED)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settlement_batches (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number     TEXT          NOT NULL,
  status           VARCHAR(30)   NOT NULL DEFAULT 'DRAFT',

  -- Aggregate snapshots (recomputed by service on item add/remove)
  total_amount     DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_owners     INTEGER       NOT NULL DEFAULT 0,
  total_hostels    INTEGER       NOT NULL DEFAULT 0,
  total_items      INTEGER       NOT NULL DEFAULT 0,
  success_count    INTEGER       NOT NULL DEFAULT 0,
  failed_count     INTEGER       NOT NULL DEFAULT 0,

  -- Provenance
  created_by       UUID          NOT NULL,
  approved_by      UUID          NULL,
  approved_at      TIMESTAMPTZ   NULL,
  processed_at     TIMESTAMPTZ   NULL,
  completed_at     TIMESTAMPTZ   NULL,
  cancelled_by     UUID          NULL,
  cancelled_at     TIMESTAMPTZ   NULL,

  -- Bank / external reference (free-form NEFT/UPI bundle ref)
  reference_number TEXT          NULL,
  notes            TEXT          NULL,
  metadata         JSONB         NOT NULL DEFAULT '{}'::jsonb,

  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT sb_status_valid CHECK (status IN (
    'DRAFT','APPROVED','PROCESSING','COMPLETED',
    'PARTIALLY_FAILED','FAILED','CANCELLED'
  )),
  CONSTRAINT sb_total_amount_nonneg CHECK (total_amount >= 0),
  CONSTRAINT sb_counts_nonneg CHECK (
    total_owners  >= 0 AND total_hostels >= 0 AND
    total_items   >= 0 AND success_count >= 0 AND failed_count >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS udx_sb_batch_number ON settlement_batches (batch_number);
CREATE INDEX IF NOT EXISTS idx_sb_status_created ON settlement_batches (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sb_created_by ON settlement_batches (created_by, created_at DESC);

-- Add the FK from ledger to batches (forward reference now resolvable)
ALTER TABLE owner_settlement_ledger
  ADD CONSTRAINT fk_osl_settlement_batch
  FOREIGN KEY (settlement_batch_id) REFERENCES settlement_batches(id) ON DELETE RESTRICT;

-- ------------------------------------------------------------
-- 3. settlement_batch_items
-- ------------------------------------------------------------
-- One row per (batch, owner, hostel). Each item carries its own
-- payout state machine so partial-batch-failure is representable.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settlement_batch_items (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          UUID          NOT NULL,
  owner_id          UUID          NOT NULL,
  hostel_id         UUID          NOT NULL,

  amount            DECIMAL(14,2) NOT NULL,
  payout_method     VARCHAR(20)   NOT NULL DEFAULT 'NEFT',
  payout_reference  TEXT          NULL,
  payout_status     VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
  failure_reason    TEXT          NULL,

  -- The specific ledger CREDIT entries this item settles.
  -- Stored as uuid[] so reconciliation can verify coverage without
  -- a join table for what is fundamentally a snapshot.
  covered_credit_ids UUID[]       NOT NULL DEFAULT ARRAY[]::UUID[],

  -- The DEBIT_PAYOUT ledger row written on success (one-to-one).
  ledger_debit_id   UUID          NULL,

  processed_by      UUID          NULL,
  processed_at      TIMESTAMPTZ   NULL,

  idempotency_key   TEXT          NOT NULL,
  metadata          JSONB         NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT sbi_amount_positive CHECK (amount > 0),
  CONSTRAINT sbi_payout_status_valid CHECK (payout_status IN (
    'PENDING','PROCESSING','SUCCESS','FAILED','CANCELLED'
  )),
  CONSTRAINT sbi_payout_method_valid CHECK (payout_method IN (
    'NEFT','IMPS','UPI','RTGS','CHEQUE','OTHER'
  )),
  CONSTRAINT sbi_success_requires_reference CHECK (
    payout_status <> 'SUCCESS' OR payout_reference IS NOT NULL
  ),
  CONSTRAINT sbi_success_requires_ledger CHECK (
    payout_status <> 'SUCCESS' OR ledger_debit_id IS NOT NULL
  ),
  CONSTRAINT sbi_failed_requires_reason CHECK (
    payout_status <> 'FAILED' OR failure_reason IS NOT NULL
  )
);

ALTER TABLE settlement_batch_items
  ADD CONSTRAINT fk_sbi_batch
  FOREIGN KEY (batch_id) REFERENCES settlement_batches(id) ON DELETE CASCADE;

ALTER TABLE settlement_batch_items
  ADD CONSTRAINT fk_sbi_ledger_debit
  FOREIGN KEY (ledger_debit_id) REFERENCES owner_settlement_ledger(id) ON DELETE RESTRICT;

-- One payout row per (batch, owner, hostel)
CREATE UNIQUE INDEX IF NOT EXISTS udx_sbi_batch_owner_hostel
  ON settlement_batch_items (batch_id, owner_id, hostel_id);

CREATE UNIQUE INDEX IF NOT EXISTS udx_sbi_idempotency_key
  ON settlement_batch_items (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_sbi_owner_status
  ON settlement_batch_items (owner_id, payout_status);

CREATE INDEX IF NOT EXISTS idx_sbi_hostel_status
  ON settlement_batch_items (hostel_id, payout_status);

CREATE INDEX IF NOT EXISTS idx_sbi_batch_status
  ON settlement_batch_items (batch_id, payout_status);

-- Add the FK from ledger to batch items (forward reference resolvable)
ALTER TABLE owner_settlement_ledger
  ADD CONSTRAINT fk_osl_batch_item
  FOREIGN KEY (batch_item_id) REFERENCES settlement_batch_items(id) ON DELETE RESTRICT;

-- ------------------------------------------------------------
-- 4. financial_reconciliation_issues
-- ------------------------------------------------------------
-- Issues raised by the ledger-level reconciliation engine.
-- Distinct from payment_operational_anomalies (provider↔attempt)
-- and from payment_reconciliation_items (attempt-level).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS financial_reconciliation_issues (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_type          VARCHAR(50)  NOT NULL,
  severity            VARCHAR(10)  NOT NULL,
  status              VARCHAR(20)  NOT NULL DEFAULT 'OPEN',

  -- Scope
  owner_id            UUID         NULL,
  hostel_id           UUID         NULL,

  -- Refs (any subset may be populated by the detector)
  payment_id          UUID         NULL,
  ledger_entry_id     UUID         NULL,
  batch_id            UUID         NULL,
  batch_item_id       UUID         NULL,

  -- Diagnostic
  fingerprint         TEXT         NOT NULL,
  description         TEXT         NOT NULL,
  metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb,

  detected_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  acknowledged_at     TIMESTAMPTZ  NULL,
  acknowledged_by     UUID         NULL,
  resolved_at         TIMESTAMPTZ  NULL,
  resolved_by         UUID         NULL,
  resolution_notes    TEXT         NULL,

  CONSTRAINT fri_severity_valid CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  CONSTRAINT fri_status_valid CHECK (status IN ('OPEN','INVESTIGATING','RESOLVED','IGNORED')),
  CONSTRAINT fri_issue_type_valid CHECK (issue_type IN (
    'PAYMENT_WITHOUT_LEDGER',
    'LEDGER_WITHOUT_PAYMENT',
    'SETTLED_EXCEEDS_COLLECTED',
    'DUPLICATE_SETTLEMENT',
    'ORPHAN_OBLIGATION',
    'WEBHOOK_MISMATCH',
    'NEGATIVE_BALANCE',
    'HOSTEL_ISOLATION_VIOLATION',
    'BATCH_AMOUNT_DRIFT',
    'BALANCE_AFTER_DRIFT'
  ))
);

-- Same logical issue should collapse — fingerprint is the dedupe key.
CREATE UNIQUE INDEX IF NOT EXISTS udx_fri_fingerprint_open
  ON financial_reconciliation_issues (fingerprint)
  WHERE status IN ('OPEN','INVESTIGATING');

CREATE INDEX IF NOT EXISTS idx_fri_status_severity
  ON financial_reconciliation_issues (status, severity, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_fri_owner ON financial_reconciliation_issues (owner_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_fri_hostel ON financial_reconciliation_issues (hostel_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_fri_issue_type ON financial_reconciliation_issues (issue_type, status);

-- ------------------------------------------------------------
-- 5. admin_financial_audit_log
-- ------------------------------------------------------------
-- Append-only by contract (service must never UPDATE/DELETE).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_financial_audit_log (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      UUID         NOT NULL,
  action_type   VARCHAR(50)  NOT NULL,
  subject_type  VARCHAR(30)  NOT NULL,
  subject_id    UUID         NOT NULL,
  owner_id      UUID         NULL,
  hostel_id     UUID         NULL,
  before_state  JSONB        NULL,
  after_state   JSONB        NULL,
  reason        TEXT         NULL,
  ip_address    TEXT         NULL,
  user_agent    TEXT         NULL,
  metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT afal_action_type_valid CHECK (action_type IN (
    'BATCH_CREATED',
    'BATCH_ITEM_ADDED',
    'BATCH_ITEM_REMOVED',
    'BATCH_APPROVED',
    'BATCH_PROCESSING_STARTED',
    'BATCH_CANCELLED',
    'PAYOUT_MARKED_SUCCESS',
    'PAYOUT_MARKED_FAILED',
    'PAYOUT_RETRIED',
    'LEDGER_ADJUSTMENT_CREDIT',
    'LEDGER_ADJUSTMENT_DEBIT',
    'LEDGER_VOIDED',
    'ISSUE_ACKNOWLEDGED',
    'ISSUE_RESOLVED',
    'ISSUE_IGNORED'
  )),
  CONSTRAINT afal_subject_type_valid CHECK (subject_type IN (
    'BATCH','BATCH_ITEM','LEDGER','OWNER','ISSUE'
  ))
);

CREATE INDEX IF NOT EXISTS idx_afal_admin_created
  ON admin_financial_audit_log (admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_afal_subject
  ON admin_financial_audit_log (subject_type, subject_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_afal_action_created
  ON admin_financial_audit_log (action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_afal_owner_created
  ON admin_financial_audit_log (owner_id, created_at DESC)
  WHERE owner_id IS NOT NULL;

-- ============================================================
-- End of 059
-- ============================================================
