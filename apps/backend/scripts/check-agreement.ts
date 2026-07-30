import { prisma } from "../lib/db";
import { interpolateRulesContent } from "../src/utils/default-rules";

async function main() {
  const agreement = await prisma.agreement.findFirst({
    where: { status: "SIGNED" },
    include: {
      tenant: {
        include: {
          profiles: true,
          hostels: true,
          room_allocations: {
            include: { room: true }
          }
        }
      }
    }
  });

  if (!agreement) {
    console.log("No signed agreement found!");
    return;
  }

  console.log("Found agreement:", agreement.id);
  const tenant = agreement.tenant;
  const room = tenant.room_allocations?.[0]?.room || null;

  const variables = {
    TENANT_NAME: tenant.profiles?.name || "Tenant",
    ROOM_NUMBER: room?.room_no ?? "N/A",
    MONTHLY_RENT: Number(agreement.contract_rent ?? 0),
    SECURITY_DEPOSIT_AMOUNT: Number(agreement.contract_security_deposit ?? 0),
    MAINTENANCE_CHARGE_AMOUNT: Number(agreement.contract_maintenance ?? 0),
    HOSTEL_NAME: tenant.hostels?.name || "Hostel",
    OWNER_NAME: "Owner Name",
    JOINING_DATE: "2026-06-19",
  };

  console.log("Variables:", variables);

  const rawRules = (agreement.rules_snapshot as any);
  console.log("Raw rules (first category rules):", rawRules.categories?.[0]?.rules);

  const interpolated = interpolateRulesContent(rawRules, variables, true);
  console.log("Interpolated rules (first category rules):", interpolated.categories?.[0]?.rules);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
