import { agreementR4ReadinessService } from "@/src/services/tenants/agreement-r4-readiness-service";
import { prisma } from "@/lib/db";

async function main() {
  const audit = await agreementR4ReadinessService.runAudit();
  console.log(audit.status);
  console.log(JSON.stringify({
    checked_at: new Date().toISOString(),
    ...audit,
  }, null, 2));
  if (audit.status !== "PASS") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.log("FAIL");
    console.error(JSON.stringify({
      checked_at: new Date().toISOString(),
      status: "FAIL",
      reasons: [error.message || "R4 readiness audit failed"],
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
