import { PrismaClient } from "@prisma/client";

// Instantiate prisma with direct connection URL to bypass connection pooling
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL
    }
  }
});

async function runReconciliation() {
  console.log("--------------------------------------------------");
  console.log("FINANCIAL LEDGER MIGRATION RECONCILIATION AUDIT");
  console.log("--------------------------------------------------");

  try {
    // 1. Check table existence to determine schema version
    const tableCheck: any[] = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('tenant_advance_ledger', 'tenant_financial_ledger')
    `;
    
    const tableNames = tableCheck.map(t => t.table_name);
    const hasNewLedger = tableNames.includes("tenant_financial_ledger");
    const hasOldLedger = tableNames.includes("tenant_advance_ledger");

    console.log(`Schema Detection:`);
    console.log(`- tenant_advance_ledger (legacy): ${hasOldLedger ? "EXISTS" : "NOT FOUND"}`);
    console.log(`- tenant_financial_ledger (new):  ${hasNewLedger ? "EXISTS" : "NOT FOUND"}`);

    if (!hasOldLedger && !hasNewLedger) {
      throw new Error("Neither tenant_advance_ledger nor tenant_financial_ledger tables found in database.");
    }

    const ledgerTable = hasNewLedger ? "tenant_financial_ledger" : "tenant_advance_ledger";
    console.log(`Using ledger table: ${ledgerTable}`);

    // 2. Check exit_settlement_transactions column name
    const columnCheck: any[] = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'exit_settlement_transactions' 
        AND column_name IN ('advance_balance', 'future_rent_credit_balance')
    `;
    const columnNames = columnCheck.map(c => c.column_name);
    const settlementColumn = columnNames.includes("future_rent_credit_balance") 
      ? "future_rent_credit_balance" 
      : columnNames.includes("advance_balance") 
        ? "advance_balance" 
        : null;

    console.log(`- Exit settlement column: ${settlementColumn || "NOT FOUND"}`);

    // 3. Query Totals
    console.log("\nAuditing Totals...");

    // Total rows
    const totalRowsRes: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::text as count, SUM(amount)::text as sum 
      FROM "${ledgerTable}"
    `);
    const totalCount = totalRowsRes[0]?.count || "0";
    const totalSum = totalRowsRes[0]?.sum || "0";
    console.log(`- Total Ledger Entries: Count = ${totalCount}, Sum = ₹${Number(totalSum).toLocaleString("en-IN")}`);

    // Totals by reason/type
    if (hasNewLedger) {
      // New schema reason totals
      const reasonsRes: any[] = await prisma.$queryRawUnsafe(`
        SELECT reason::text, COUNT(*)::text as count, SUM(amount)::text as sum
        FROM "${ledgerTable}"
        GROUP BY reason
      `);
      console.log("\nLedger Breakdown (New Schema Reasons):");
      reasonsRes.forEach(r => {
        console.log(`  * ${r.reason}: Count = ${r.count}, Sum = ₹${Number(r.sum || 0).toLocaleString("en-IN")}`);
      });

      // Map new reasons back to legacy terminology to verify reconciliation
      console.log("\nLegacy Terminology Reconstructed Totals:");
      const depositSum = reasonsRes.filter(r => r.reason === "SECURITY_DEPOSIT_COLLECTED").reduce((acc, r) => acc + Number(r.sum || 0), 0);
      const refundSum = reasonsRes.filter(r => r.reason === "SECURITY_DEPOSIT_REFUNDED").reduce((acc, r) => acc + Number(r.sum || 0), 0);
      const deductionSum = reasonsRes.filter(r => r.reason === "SECURITY_DEPOSIT_DEDUCTION").reduce((acc, r) => acc + Number(r.sum || 0), 0);
      const creditSum = reasonsRes.filter(r => ["FUTURE_RENT_CREDIT_TOPUP", "FUTURE_RENT_CREDIT_ADJUSTMENT"].includes(r.reason)).reduce((acc, r) => acc + Number(r.sum || 0), 0);

      console.log(`  - Reconstructed DEPOSIT (Security Deposit Collected): ₹${depositSum.toLocaleString("en-IN")}`);
      console.log(`  - Reconstructed REFUND (Security Deposit Refunded):   ₹${refundSum.toLocaleString("en-IN")}`);
      console.log(`  - Reconstructed DEDUCTION (Security Deposit Deducted): ₹${deductionSum.toLocaleString("en-IN")}`);
      console.log(`  - Reconstructed TOPUP/ADJUSTMENT (Future Rent Credit):  ₹${creditSum.toLocaleString("en-IN")}`);

    } else {
      // Legacy schema reason totals
      const reasonsRes: any[] = await prisma.$queryRawUnsafe(`
        SELECT reason::text, COUNT(*)::text as count, SUM(amount)::text as sum
        FROM "${ledgerTable}"
        GROUP BY reason
      `);
      console.log("\nLedger Breakdown (Legacy Reasons):");
      reasonsRes.forEach(r => {
        console.log(`  * ${r.reason}: Count = ${r.count}, Sum = ₹${Number(r.sum || 0).toLocaleString("en-IN")}`);
      });
    }

    // 4. Audit Exit Settlement Transactions
    if (settlementColumn) {
      const settlementRes: any[] = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::text as count, 
               SUM(security_deposit_amount)::text as sd_sum,
               SUM("${settlementColumn}")::text as adv_sum
        FROM "exit_settlement_transactions"
      `);
      console.log("\nExit Settlement Transactions Audit:");
      console.log(`  - Total Transactions: ${settlementRes[0]?.count || "0"}`);
      console.log(`  - Total Security Deposits: ₹${Number(settlementRes[0]?.sd_sum || 0).toLocaleString("en-IN")}`);
      console.log(`  - Total Future Rent Credits (${settlementColumn}): ₹${Number(settlementRes[0]?.adv_sum || 0).toLocaleString("en-IN")}`);
    } else {
      console.log("\nExit Settlement Transactions table/columns not found.");
    }

    // 5. Audit Rent Obligations mapping
    const rentObRes: any[] = await prisma.$queryRaw`
      SELECT obligation_type::text, COUNT(*)::text as count, SUM(amount)::text as sum
      FROM "rent_obligations"
      WHERE obligation_type::text IN ('SECURITY_DEPOSIT', 'ADVANCE')
      GROUP BY obligation_type
    `;
    console.log("\nRent Obligations Audit:");
    if (rentObRes.length === 0) {
      console.log("  No SECURITY_DEPOSIT or ADVANCE rent obligations found.");
    } else {
      rentObRes.forEach(r => {
        console.log(`  * ${r.obligation_type}: Count = ${r.count}, Sum = ₹${Number(r.sum || 0).toLocaleString("en-IN")}`);
      });
    }

    // 6. Audit Payment Attempts mapping
    const attemptsRes: any[] = await prisma.$queryRaw`
      SELECT flow_type::text, COUNT(*)::text as count, SUM(amount)::text as sum
      FROM "payment_attempts"
      WHERE flow_type::text IN ('SECURITY_DEPOSIT', 'FUTURE_RENT_CREDIT', 'ADVANCE', 'DEPOSIT')
         OR payment_type::text IN ('SECURITY_DEPOSIT', 'FUTURE_RENT_CREDIT', 'ADVANCE', 'DEPOSIT')
      GROUP BY flow_type
    `;
    console.log("\nPayment Attempts Audit:");
    if (attemptsRes.length === 0) {
      console.log("  No security deposit / rent credit payment attempts found.");
    } else {
      attemptsRes.forEach(r => {
        console.log(`  * Flow Type [${r.flow_type}]: Count = ${r.count}, Sum = ₹${Number(r.sum || 0).toLocaleString("en-IN")}`);
      });
    }

    console.log("\nReconciliation completed successfully.");

  } catch (error: any) {
    console.error("\nReconciliation failed:");
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

runReconciliation();
