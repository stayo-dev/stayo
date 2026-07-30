import { prisma } from "../lib/db";

async function main() {
  const tenantId = "08b4583e-152a-495d-8bad-8a50bc6e3768"; // Shiva's tenant ID
  console.log(`Auditing records for tenant ${tenantId}...`);

  const allocations = await prisma.roomAllocation.findMany({
    where: { tenant_id: tenantId },
    orderBy: { start_date: "asc" }
  });
  console.log("\n=== Allocations ===");
  console.log(JSON.stringify(allocations, null, 2));

  const moveOuts = await prisma.move_out_requests.findMany({
    where: { tenant_id: tenantId },
  });
  console.log("\n=== Move Out Requests ===");
  console.log(JSON.stringify(moveOuts, null, 2));

  const activityLogs = await prisma.activity_logs.findMany({
    where: {
      OR: [
        { entity_id: tenantId },
        { user_id: tenantId }
      ]
    },
    orderBy: { timestamp: "desc" }
  });
  console.log("\n=== Activity Logs ===");
  console.log(JSON.stringify(activityLogs, null, 2));

  const actionLogs = await prisma.actionLog.findMany({
    orderBy: { created_at: "desc" },
    take: 10
  });
  console.log("\n=== Recent Action Logs ===");
  console.log(JSON.stringify(actionLogs, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
