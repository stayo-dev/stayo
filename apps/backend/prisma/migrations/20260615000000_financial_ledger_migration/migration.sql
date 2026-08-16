-- 1. Create the new enum types if they don't exist
DO $$ BEGIN
  CREATE TYPE "FinancialLedgerType" AS ENUM ('CREDIT', 'DEBIT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "FinancialLedgerReason" AS ENUM (
    'SECURITY_DEPOSIT_COLLECTED',
    'FUTURE_RENT_CREDIT_TOPUP',
    'FUTURE_RENT_CREDIT_ADJUSTMENT',
    'SECURITY_DEPOSIT_DEDUCTION',
    'SECURITY_DEPOSIT_REFUNDED',
    'LEDGER_CORRECTION'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Rename the table if it exists
DO $$ BEGIN
  ALTER TABLE "tenant_advance_ledger" RENAME TO "tenant_financial_ledger";
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 3. Modify the columns in the renamed table to use new types with conversion mapping
DO $$ BEGIN
  ALTER TABLE "tenant_financial_ledger" 
    ALTER COLUMN "type" TYPE "FinancialLedgerType" USING "type"::text::"FinancialLedgerType",
    ALTER COLUMN "reason" TYPE "FinancialLedgerReason" USING (
      CASE "reason"::text
        WHEN 'DEPOSIT' THEN 'SECURITY_DEPOSIT_COLLECTED'::"FinancialLedgerReason"
        WHEN 'TOPUP' THEN 'FUTURE_RENT_CREDIT_TOPUP'::"FinancialLedgerReason"
        WHEN 'ADJUSTMENT' THEN 'FUTURE_RENT_CREDIT_ADJUSTMENT'::"FinancialLedgerReason"
        WHEN 'DEDUCTION' THEN 'SECURITY_DEPOSIT_DEDUCTION'::"FinancialLedgerReason"
        WHEN 'REFUND' THEN 'SECURITY_DEPOSIT_REFUNDED'::"FinancialLedgerReason"
        WHEN 'CORRECTION' THEN 'LEDGER_CORRECTION'::"FinancialLedgerReason"
        ELSE 'LEDGER_CORRECTION'::"FinancialLedgerReason"
      END
    );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 4. Drop the old enum types
-- Step 2's rename silently no-ops (via `EXCEPTION WHEN OTHERS THEN NULL`)
-- on a database where `tenant_financial_ledger` already exists as a
-- separate table under its final name — confirmed live 2026-08-15 while
-- resolving a stuck `migrate deploy`: `tenant_financial_ledger` already
-- held the real 33 rows of ledger data, correctly on the new enum types,
-- while `tenant_advance_ledger` survived as an empty (0-row), orphaned
-- leftover still on the old types — the only thing left referencing them,
-- confirmed via information_schema before dropping. Explicitly dropping it
-- here (rather than a blanket CASCADE on the enum DROPs, which could
-- silently take out something unexpected) makes this migration converge to
-- the same end state whether it's renaming a still-old-named table or
-- cleaning up after that rename already happened by hand.
DROP TABLE IF EXISTS "tenant_advance_ledger";
DROP TYPE IF EXISTS "AdvanceLedgerType";
DROP TYPE IF EXISTS "AdvanceLedgerReason";

-- 5. Rename column advance_deposit to security_deposit in tenants table
DO $$ BEGIN
  ALTER TABLE "tenants" RENAME COLUMN "advance_deposit" TO "security_deposit";
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 6. Rename column advance_balance to future_rent_credit_balance in exit_settlement_transactions table
DO $$ BEGIN
  ALTER TABLE "exit_settlement_transactions" RENAME COLUMN "advance_balance" TO "future_rent_credit_balance";
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 7. Update old string references in database
-- Original SQL referenced "paymentAttempt" (camelCase, matching neither this
-- table's actual name nor this codebase's snake_case convention) — the real
-- table is "payment_attempts", confirmed live 2026-08-15 while resolving a
-- stuck `migrate deploy`.
UPDATE "rent_obligations" SET "obligation_type" = 'SECURITY_DEPOSIT' WHERE "obligation_type" = 'ADVANCE';

UPDATE "payment_attempts" SET "flow_type" = 'FUTURE_RENT_CREDIT' WHERE "flow_type" = 'ADVANCE';
UPDATE "payment_attempts" SET "flow_type" = 'SECURITY_DEPOSIT' WHERE "flow_type" = 'DEPOSIT';
UPDATE "payment_attempts" SET "payment_type" = 'FUTURE_RENT_CREDIT' WHERE "payment_type" = 'ADVANCE';
UPDATE "payment_attempts" SET "payment_type" = 'SECURITY_DEPOSIT' WHERE "payment_type" = 'DEPOSIT';

-- The original SQL here also targeted "payments" with these same four
-- UPDATEs, but "payments" never has (and, per the current schema.prisma
-- model, never had) flow_type/payment_type columns — confirmed live
-- 2026-08-15 while resolving a stuck `migrate deploy`. That classification
-- lives on "payment_attempts" (already updated above) and
-- "rent_obligations.obligation_type" (already updated above); removed as
-- dead statements rather than left to fail every future deploy attempt.
