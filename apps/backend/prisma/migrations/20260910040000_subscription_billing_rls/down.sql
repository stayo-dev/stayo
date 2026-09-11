-- Reverts 20260910040000_subscription_billing_rls.

DROP POLICY IF EXISTS "owner_subscriptions_select_own_or_admin" ON "owner_subscriptions";
DROP POLICY IF EXISTS "subscription_payments_select_own_or_admin" ON "subscription_payments";
DROP POLICY IF EXISTS "subscription_invoices_select_own_or_admin" ON "subscription_invoices";
DROP POLICY IF EXISTS "owner_billing_profiles_select_own_or_admin" ON "owner_billing_profiles";

ALTER TABLE "owner_subscriptions" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_payments" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_invoices" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "owner_billing_profiles" DISABLE ROW LEVEL SECURITY;
