import { PrismaClient } from "@prisma/client";
import { getTenantOperationalContext } from "../lib/hostel-context";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenants.findFirst({
    select: { id: true, owner_id: true, hostel_id: true }
  });
  if (!tenant) {
    console.log("No tenant found");
    return;
  }
  console.log("Tenant info:", tenant);
  const context = await getTenantOperationalContext(tenant.id, tenant.owner_id, tenant.hostel_id);
  console.log("Resolved context:", JSON.stringify({
    hostelId: context.hostel.id,
    hostelName: context.hostel.name,
    prefs: {
      advance_enabled: context.prefs.advance_enabled,
      billing_deposit_enabled: context.prefs.billing_defaults?.advance_deposit
    }
  }, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
