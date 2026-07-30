-- Idempotency key: prevents double rent generation
-- If cron runs twice, the second run silently skips
CREATE UNIQUE INDEX IF NOT EXISTS "rent_obligations_allocation_id_rent_month_key" 
ON "public"."rent_obligations"("allocation_id", "rent_month");
