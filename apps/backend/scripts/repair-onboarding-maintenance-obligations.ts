import { prisma } from "../lib/db";
import { onboardingMaintenanceRepairService } from "../src/services/payments/onboarding-maintenance-repair-service";
import { activationFinancialStatusService } from "../src/services/tenants/activation-financial-status-service";

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await onboardingMaintenanceRepairService.repairMissingOnboardingMaintenance({
    dryRun: !apply,
  });

  const verification = await Promise.all(
    result.candidates.map(async (candidate) => ({
      tenant_id: candidate.tenantId,
      financial_status: await activationFinancialStatusService.getActivationFinancialStatus(candidate.tenantId),
    }))
  );

  console.log(JSON.stringify({
    mode: apply ? "APPLY" : "DRY_RUN",
    affected_before: result.affectedBefore,
    repaired: result.repaired,
    still_missing: result.stillMissing,
    skipped: result.skipped,
    candidates: result.candidates.map((candidate) => ({
      tenant_id: candidate.tenantId,
      hostel_id: candidate.hostelId,
      joining_date: candidate.joiningDate,
      maintenance_charge: candidate.maintenanceCharge,
      maintenance_type: candidate.maintenanceType,
    })),
    activation_financial_status: verification,
  }, null, 2));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
