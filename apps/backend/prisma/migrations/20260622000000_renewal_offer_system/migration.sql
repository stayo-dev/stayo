-- Phase 1: Renewal Offer System
-- Introduces RenewalOffer (contract negotiation) and BulkRenewalBatch (bulk operations)

-- 1. Add SECURITY_DEPOSIT_TOPUP to the financial ledger reason enum
ALTER TYPE "FinancialLedgerReason" ADD VALUE IF NOT EXISTS 'SECURITY_DEPOSIT_TOPUP';

-- 2. Create RenewalOfferStatus enum
DO $$ BEGIN
  CREATE TYPE "RenewalOfferStatus" AS ENUM (
    'DRAFT',
    'SENT',
    'ACCEPTED',
    'DECLINED',
    'EXPIRED',
    'REVISED',
    'SUPERSEDED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3. Create BulkRenewalBatch table (referenced by RenewalOffer)
CREATE TABLE IF NOT EXISTS "BulkRenewalBatch" (
  "id"                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id"               UUID NOT NULL,
  "hostel_id"              UUID NOT NULL REFERENCES "hostels"("id") ON DELETE CASCADE,
  "title"                  TEXT NOT NULL DEFAULT 'Bulk Renewal',
  "filter_criteria"        JSONB NOT NULL DEFAULT '{}',
  "renewal_strategy"       TEXT NOT NULL DEFAULT 'FLAT',
  "proposed_rent"          DECIMAL(10,2),
  "proposed_deposit"       DECIMAL(10,2),
  "proposed_duration_months" INT,
  "rent_increase_amount"   DECIMAL(10,2),
  "rent_increase_percent"  DECIMAL(5,2),
  "offers_generated"       INT NOT NULL DEFAULT 0,
  "offers_sent"            INT NOT NULL DEFAULT 0,
  "offers_accepted"        INT NOT NULL DEFAULT 0,
  "offers_declined"        INT NOT NULL DEFAULT 0,
  "status"                 TEXT NOT NULL DEFAULT 'DRAFT',
  "created_at"             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completed_at"           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "idx_bulk_renewal_batch_owner" ON "BulkRenewalBatch"("owner_id", "hostel_id", "status");

-- 4. Create RenewalOffer table
CREATE TABLE IF NOT EXISTS "RenewalOffer" (
  "id"                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "agreement_id"               UUID NOT NULL REFERENCES "Agreement"("id") ON DELETE CASCADE,
  "tenant_id"                  UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "hostel_id"                  UUID NOT NULL REFERENCES "hostels"("id") ON DELETE CASCADE,
  "owner_id"                   UUID NOT NULL,
  "batch_id"                   UUID REFERENCES "BulkRenewalBatch"("id") ON DELETE SET NULL,

  -- Proposed contract terms
  "proposed_rent"              DECIMAL(10,2) NOT NULL,
  "proposed_security_deposit"  DECIMAL(10,2) NOT NULL,
  "proposed_maintenance"       DECIMAL(10,2) NOT NULL DEFAULT 0,
  "proposed_maintenance_type"  TEXT,
  "proposed_duration_months"   INT NOT NULL,
  "proposed_start_date"        DATE NOT NULL,
  "proposed_end_date"          DATE NOT NULL,
  "proposed_payment_frequency" TEXT,
  "effective_from"             DATE NOT NULL,

  -- Current terms snapshot (for comparison display)
  "current_rent"               DECIMAL(10,2) NOT NULL,
  "current_security_deposit"   DECIMAL(10,2) NOT NULL,
  "current_maintenance"        DECIMAL(10,2) NOT NULL DEFAULT 0,

  -- Deposit delta (computed at offer time from ledger)
  "deposit_held"               DECIMAL(10,2) NOT NULL DEFAULT 0,
  "additional_deposit_required" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "deposit_refund_eligible"    DECIMAL(10,2) NOT NULL DEFAULT 0,

  -- Status tracking
  "status"                     "RenewalOfferStatus" NOT NULL DEFAULT 'DRAFT',
  "offer_expires_at"           TIMESTAMPTZ,
  "sent_at"                    TIMESTAMPTZ,
  "accepted_at"                TIMESTAMPTZ,
  "declined_at"                TIMESTAMPTZ,
  "decline_reason"             TEXT,
  "revised_from_offer_id"      UUID REFERENCES "RenewalOffer"("id") ON DELETE SET NULL,

  -- Owner notes
  "owner_notes"                TEXT,
  "is_custom_override"         BOOLEAN NOT NULL DEFAULT FALSE,

  -- Result
  "resulting_agreement_id"     UUID REFERENCES "Agreement"("id") ON DELETE SET NULL,

  "created_at"                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"                 TIMESTAMPTZ
);

-- Indexes for common access patterns
CREATE INDEX IF NOT EXISTS "idx_renewal_offer_agreement" ON "RenewalOffer"("agreement_id", "status");
CREATE INDEX IF NOT EXISTS "idx_renewal_offer_tenant" ON "RenewalOffer"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "idx_renewal_offer_hostel" ON "RenewalOffer"("hostel_id", "status");
CREATE INDEX IF NOT EXISTS "idx_renewal_offer_batch" ON "RenewalOffer"("batch_id") WHERE "batch_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_renewal_offer_status_expiry" ON "RenewalOffer"("status", "offer_expires_at") WHERE "status" IN ('DRAFT', 'SENT');
CREATE INDEX IF NOT EXISTS "idx_renewal_offer_owner" ON "RenewalOffer"("owner_id", "hostel_id", "status");
