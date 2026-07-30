-- Financial Lifecycle: obligation activation + future credit consumption
-- Adds a distinct ledger reason for future-credit consumption, replacing the
-- generic "ADJUSTMENT" label previously used at the sole EXISTING_CREDIT
-- debit call site in settlement-engine.ts. Paired with the existing
-- FUTURE_RENT_CREDIT_TOPUP for full audit traceability of credit
-- creation vs. consumption.

ALTER TYPE "FinancialLedgerReason" ADD VALUE IF NOT EXISTS 'FUTURE_CREDIT_APPLIED';
