import { prisma } from "../lib/db";

async function main() {
  try {
    const tenantId = "25cfa9c9-970f-42a9-83ce-50b28ea573d2";
    
    console.log("=== TENANT ===");
    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      include: { profiles: true }
    });
    console.log(JSON.stringify(tenant, null, 2));

    console.log("\n=== AGREEMENT ===");
    const agreement = await prisma.agreement.findFirst({
      where: { tenant_id: tenantId }
    });
    console.log(JSON.stringify(agreement, null, 2));

    console.log("\n=== LEDGER ENTRIES ===");
    const ledger = await prisma.tenant_financial_ledger.findMany({
      where: { tenant_id: tenantId }
    });
    console.log(JSON.stringify(ledger, null, 2));

    console.log("\n=== RENT OBLIGATIONS ===");
    const obligations = await prisma.rent_obligations.findMany({
      where: { tenant_id: tenantId }
    });
    console.log(JSON.stringify(obligations, null, 2));
  } catch (err: any) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
