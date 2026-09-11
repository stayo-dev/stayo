-- Phase 13: online payment-gateway support alongside the existing manual
-- (UPI_MANUAL / CASH) subscription-payment flow. Additive only — no existing
-- column, row, or constraint is changed or removed.

-- New terminal/in-flight statuses for a GATEWAY payment. UPI_MANUAL/CASH never
-- use these — they stay on the existing SUBMITTED -> APPROVED/REJECTED path.
ALTER TYPE "SubscriptionPaymentStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "SubscriptionPaymentStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "SubscriptionPaymentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- Gateway linkage on the existing payment row — nullable, so every
-- UPI_MANUAL/CASH row is entirely unaffected.
ALTER TABLE "subscription_payments"
  ADD COLUMN IF NOT EXISTS "gateway_provider" TEXT,
  ADD COLUMN IF NOT EXISTS "gateway_order_id" TEXT,
  ADD COLUMN IF NOT EXISTS "gateway_payment_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_payments_gateway_order_id_key"
  ON "subscription_payments" ("gateway_order_id");
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_payments_gateway_payment_id_key"
  ON "subscription_payments" ("gateway_payment_id");

-- Dedicated webhook idempotency/audit table for subscription-billing gateway
-- events — separate from the tenant-rent `payment_webhook_events` table.
CREATE TABLE IF NOT EXISTS "subscription_payment_gateway_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_hash" TEXT NOT NULL,
  "payment_id" UUID,
  "gateway_order_id" TEXT,
  "gateway_payment_id" TEXT,
  "event_type" TEXT,
  "signature_verified" BOOLEAN NOT NULL DEFAULT false,
  "raw_payload" JSONB NOT NULL,
  "processing_status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "error_message" TEXT,
  "received_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "processed_at" TIMESTAMPTZ,

  CONSTRAINT "subscription_payment_gateway_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_payment_gateway_events_event_hash_key"
  ON "subscription_payment_gateway_events" ("event_hash");
CREATE INDEX IF NOT EXISTS "subscription_payment_gateway_events_payment_id_idx"
  ON "subscription_payment_gateway_events" ("payment_id");
CREATE INDEX IF NOT EXISTS "subscription_payment_gateway_events_gateway_order_id_idx"
  ON "subscription_payment_gateway_events" ("gateway_order_id");
CREATE INDEX IF NOT EXISTS "subscription_payment_gateway_events_received_at_idx"
  ON "subscription_payment_gateway_events" ("received_at");

ALTER TABLE "subscription_payment_gateway_events"
  ADD CONSTRAINT "subscription_payment_gateway_events_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "subscription_payments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: same read-only owner-or-admin policy as the other 4 billing tables
-- (migration 20260910040000_subscription_billing_rls). Webhook events carry
-- no owner_id directly, so scope through the payment they reference.
ALTER TABLE "subscription_payment_gateway_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscription_payment_gateway_events_select_own_or_admin"
  ON "subscription_payment_gateway_events"
  FOR SELECT
  USING (
    payment_id IN (
      SELECT id FROM subscription_payments
      WHERE owner_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
    )
    OR EXISTS (SELECT 1 FROM profiles WHERE auth_user_id = auth.uid() AND role = 'ADMIN')
  );
