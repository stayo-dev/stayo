-- P0 Fix: Prevent duplicate active RENT obligations per tenant per billing period.
--
-- Root cause: OnboardingFinancialsService creates RENT with allocation_id=NULL,
-- then AgreementRentScheduleService creates another RENT with allocation_id=NULL.
-- The existing @@unique([allocation_id, rent_month, obligation_type]) cannot
-- catch this because NULL != NULL in SQL.
--
-- This partial unique index enforces: at most ONE active (non-superseded) RENT
-- obligation per tenant per rent_month.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_rent_obligations_tenant_month_type_active"
ON "rent_obligations" ("tenant_id", "rent_month", "obligation_type")
WHERE "is_superseded" = false AND "obligation_type" = 'RENT';
