import { PrismaClient } from "@prisma/client";

// Instantiate prisma with direct connection URL to bypass connection pooling
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL
    }
  }
});

const STATEMENTS = [
  // 1. Create the new enum types if they don't exist
  `DO $$ BEGIN
    CREATE TYPE "FinancialLedgerType" AS ENUM ('CREDIT', 'DEBIT');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;`,

  `DO $$ BEGIN
    CREATE TYPE "FinancialLedgerReason" AS ENUM (
      'SECURITY_DEPOSIT_COLLECTED',
      'FUTURE_RENT_CREDIT_TOPUP',
      'FUTURE_RENT_CREDIT_ADJUSTMENT',
      'SECURITY_DEPOSIT_DEDUCTION',
      'SECURITY_DEPOSIT_REFUNDED',
      'LEDGER_CORRECTION'
    );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;`,

  // 2. Rename the table if it exists
  `DO $$ BEGIN
    ALTER TABLE "tenant_advance_ledger" RENAME TO "tenant_financial_ledger";
  EXCEPTION WHEN OTHERS THEN NULL;
  END $$;`,

  // 3. Modify the columns in the renamed table to use new types with conversion mapping
  `DO $$ BEGIN
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
  END $$;`,

  // 4. Drop the old enum types
  `DROP TYPE IF EXISTS "AdvanceLedgerType";`,
  `DROP TYPE IF EXISTS "AdvanceLedgerReason";`,

  // 5. Rename column advance_deposit to security_deposit in tenants table
  `DO $$ BEGIN
    ALTER TABLE "tenants" RENAME COLUMN "advance_deposit" TO "security_deposit";
  EXCEPTION WHEN OTHERS THEN NULL;
  END $$;`,

  // 6. Rename column advance_balance to future_rent_credit_balance in exit_settlement_transactions table
  `DO $$ BEGIN
    ALTER TABLE "exit_settlement_transactions" RENAME COLUMN "advance_balance" TO "future_rent_credit_balance";
  EXCEPTION WHEN OTHERS THEN NULL;
  END $$;`,

  // 7. Update old string references in database
  `UPDATE "rent_obligations" SET "obligation_type" = 'SECURITY_DEPOSIT' WHERE "obligation_type" = 'ADVANCE';`,

  `UPDATE "payment_attempts" SET "flow_type" = 'FUTURE_RENT_CREDIT' WHERE "flow_type" = 'ADVANCE';`,
  `UPDATE "payment_attempts" SET "flow_type" = 'SECURITY_DEPOSIT' WHERE "flow_type" = 'DEPOSIT';`,
  `UPDATE "payment_attempts" SET "payment_type" = 'FUTURE_RENT_CREDIT' WHERE "payment_type" = 'ADVANCE';`,
  `UPDATE "payment_attempts" SET "payment_type" = 'SECURITY_DEPOSIT' WHERE "payment_type" = 'DEPOSIT';`
];

async function main() {
  console.log("Applying", STATEMENTS.length, "migration statements one by one...");

  for (let i = 0; i < STATEMENTS.length; i++) {
    const stmt = STATEMENTS[i];
    console.log(`Executing statement [${i + 1}/${STATEMENTS.length}]:`);
    console.log(stmt.substring(0, 150) + (stmt.length > 150 ? "..." : ""));
    try {
      await prisma.$executeRawUnsafe(stmt);
      console.log("Success.");
    } catch (err: any) {
      console.error("FAILED statement:", stmt);
      console.error("Error details:", err.message);
      throw err;
    }
  }

  console.log("Migration executed successfully!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
