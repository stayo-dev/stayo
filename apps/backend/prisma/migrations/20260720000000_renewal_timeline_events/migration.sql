-- Renewal Timeline: append-only audit trail for the Agreement Renewal
-- subsystem. Closes the gap where owner-side offer actions (created, sent,
-- revised) had no queryable DB record at all (only logger.info() lines),
-- and tenant-side actions were only partially captured in RenewalDecision
-- (no actor-role, no distinct event vocabulary — "discuss" reused the
-- RenewalOfferStatus.SENT value). See docs/business-logic/
-- renewal-management-workspace-gap-analysis.md S1.6 and Decisions.md ADR-016.

-- 1. Event-type enum
DO $$ BEGIN
  CREATE TYPE "RenewalTimelineEventType" AS ENUM (
    'OFFER_CREATED',
    'OFFER_SENT',
    'OFFER_DISCUSSED',
    'OFFER_REVISED',
    'OFFER_ACCEPTED',
    'OFFER_DECLINED',
    'OFFER_EXPIRED',
    'DRAFT_CREATED',
    'RENEWAL_ACTIVATED',
    'RENEWAL_ACTIVATION_BLOCKED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Actor-type enum
DO $$ BEGIN
  CREATE TYPE "RenewalTimelineActorType" AS ENUM ('OWNER', 'TENANT', 'SYSTEM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3. RenewalTimelineEvent table
CREATE TABLE IF NOT EXISTS "RenewalTimelineEvent" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "hostel_id"    UUID NOT NULL REFERENCES "hostels"("id") ON DELETE CASCADE,
  "tenant_id"    UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "agreement_id" UUID REFERENCES "Agreement"("id") ON DELETE SET NULL,
  "offer_id"     UUID REFERENCES "RenewalOffer"("id") ON DELETE SET NULL,
  "event_type"   "RenewalTimelineEventType" NOT NULL,
  "actor_type"   "RenewalTimelineActorType" NOT NULL,
  "actor_id"     UUID,
  "reason"       TEXT,
  "metadata"     JSONB,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_renewal_timeline_event_tenant" ON "RenewalTimelineEvent"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_renewal_timeline_event_agreement" ON "RenewalTimelineEvent"("agreement_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_renewal_timeline_event_offer" ON "RenewalTimelineEvent"("offer_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_renewal_timeline_event_hostel" ON "RenewalTimelineEvent"("hostel_id", "created_at");
