import { prisma } from "../lib/db";
import { paymentService } from "../src/services/payments/payment-service";
import { financialService } from "../src/services/payments/financial-service";
import * as fs from "fs";
import * as path from "path";

const TENANT_ID = "25cfa9c9-970f-42a9-83ce-50b28ea573d2";
const OBLIGATION_ID = "3f53177e-e8ac-41ff-b02a-3731a2446c47";

function replaceDepositInObj(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map(item => replaceDepositInObj(item));
  }
  if (typeof obj === "object") {
    // If it's a Decimal representation from Prisma serialization, e.g. { d: [15000], e: 0, s: 1 }
    // Or similar, but when we load it as JSON from database, it's just regular nested fields.
    const res: any = {};
    for (const key of Object.keys(obj)) {
      res[key] = replaceDepositInObj(obj[key]);
    }
    return res;
  }
  if (typeof obj === "string") {
    let updated = obj.replace(/15000/g, "0");
    updated = updated.replace(/15,000/g, "0");
    return updated;
  }
  if (typeof obj === "number") {
    if (obj === 15000) {
      return 0;
    }
  }
  return obj;
}

async function main() {
  const isApply = process.argv.includes("--apply");
  console.log(`=== RUNNING IN ${isApply ? "APPLY" : "DRY-RUN"} MODE ===`);

  try {
    // 1. Fetch current data
    const tenant = await prisma.tenants.findUnique({
      where: { id: TENANT_ID },
      include: { room_allocations: true }
    });
    if (!tenant) throw new Error("Tenant not found");

    const agreement = await prisma.agreement.findFirst({
      where: { tenant_id: TENANT_ID }
    });
    if (!agreement) throw new Error("Agreement not found");

    const obligation = await prisma.rent_obligations.findUnique({
      where: { id: OBLIGATION_ID }
    });
    if (!obligation) throw new Error("Security Deposit Obligation not found");

    console.log("Current Tenant security_deposit:", tenant.security_deposit.toString());
    console.log("Current Agreement contract_security_deposit:", agreement.contract_security_deposit?.toString());
    console.log("Current Obligation status:", obligation.status, "amount:", obligation.amount.toString());

    // 2. Write Backup
    const backupData = {
      timestamp: new Date().toISOString(),
      tenant,
      agreement,
      obligation
    };
    const backupDir = path.join(__dirname, "backups");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    const backupPath = path.join(backupDir, `backup-shreyan-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), "utf8");
    console.log(`\n[BACKUP] Original state written to: ${backupPath}`);

    // 3. Process modifications
    const updatedContentSnapshot = replaceDepositInObj(agreement.content_snapshot);
    const updatedRulesSnapshot = replaceDepositInObj(agreement.rules_snapshot);

    console.log("\n[DIFF] content_snapshot change snippet:");
    console.log("Original advance_deposit:", (agreement.content_snapshot as any).advance_deposit);
    console.log("Updated advance_deposit:", updatedContentSnapshot.advance_deposit);

    if (isApply) {
      console.log("\nApplying changes to database...");
      
      // We will perform updates in a transaction
      await prisma.$transaction(async (tx) => {
        // Update tenant
        await tx.tenants.update({
          where: { id: TENANT_ID },
          data: { security_deposit: 0 }
        });

        // Update agreement
        await tx.agreement.update({
          where: { id: agreement.id },
          data: {
            contract_security_deposit: 0,
            content_snapshot: updatedContentSnapshot,
            rules_snapshot: updatedRulesSnapshot
          }
        });

        // Update obligation to clear amount and hide it from timeline
        await tx.rent_obligations.update({
          where: { id: OBLIGATION_ID },
          data: {
            amount: 0,
            total_amount: 0,
            is_superseded: true,
            superseded_at: new Date()
          }
        });
      });

      console.log("Database transaction succeeded (Tenant and Agreement updated).");

      // Waive the obligation using canonical service method
      // The second argument is the owner ID: tenant.owner_id
      console.log(`Waiving security deposit obligation ${OBLIGATION_ID}...`);
      await paymentService.waiveObligation(OBLIGATION_ID, tenant.owner_id);
      console.log("Obligation waived successfully.");

      // 4. Verify post-run state
      console.log("\n=== VERIFYING POST-RUN STATE ===");
      const updatedTenant = await prisma.tenants.findUnique({
        where: { id: TENANT_ID }
      });
      const updatedAgreement = await prisma.agreement.findFirst({
        where: { tenant_id: TENANT_ID }
      });
      const updatedObligation = await prisma.rent_obligations.findUnique({
        where: { id: OBLIGATION_ID }
      });

      console.log("Post-run Tenant security_deposit:", updatedTenant?.security_deposit.toString());
      console.log("Post-run Agreement contract_security_deposit:", updatedAgreement?.contract_security_deposit?.toString());
      console.log("Post-run Obligation status:", updatedObligation?.status);

      // Verify dynamic calculations via financialService
      const financialStatus = await financialService.getTenantFinancialStatus(TENANT_ID);
      console.log("\n=== DYNAMIC FINANCIAL STATUS ===");
      console.log(JSON.stringify(financialStatus, null, 2));

      if (financialStatus.payable_now !== 7500) {
        console.error(`WARNING: payable_now is ${financialStatus.payable_now}, expected 7500!`);
      } else {
        console.log("SUCCESS: payable_now is exactly 7500.");
      }

      if (financialStatus.future_outstanding !== 7500) {
        console.error(`WARNING: future_outstanding is ${financialStatus.future_outstanding}, expected 7500!`);
      } else {
        console.log("SUCCESS: future_outstanding is exactly 7500 (representing the July 2026 rent).");
      }
    } else {
      console.log("\n[DRY-RUN] No updates were made to the database. Run with --apply to commit changes.");
    }
  } catch (err) {
    console.error("Error running script:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
