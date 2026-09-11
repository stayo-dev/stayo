-- Reverses 20260911100000_subscription_gateway_payments.
-- Note: Postgres cannot remove values from an enum type. Reversing this
-- migration leaves 'PENDING' / 'FAILED' / 'CANCELLED' defined on
-- SubscriptionPaymentStatus (harmless if unused) but drops everything else.

DROP POLICY IF EXISTS "subscription_payment_gateway_events_select_own_or_admin" ON "subscription_payment_gateway_events";
ALTER TABLE IF EXISTS "subscription_payment_gateway_events" DISABLE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS "subscription_payment_gateway_events";

DROP INDEX IF EXISTS "subscription_payments_gateway_order_id_key";
DROP INDEX IF EXISTS "subscription_payments_gateway_payment_id_key";

ALTER TABLE "subscription_payments"
  DROP COLUMN IF EXISTS "gateway_provider",
  DROP COLUMN IF EXISTS "gateway_order_id",
  DROP COLUMN IF EXISTS "gateway_payment_id";
