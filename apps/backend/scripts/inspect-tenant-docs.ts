import { prisma } from "../lib/db";

async function main() {
  const tenantId = "5db1a00d-3cf2-43f9-aa17-db163290392a";
  
  const tenant = await prisma.tenants.findUnique({
    where: { id: tenantId },
    include: {
      identification_documents: true,
      agreements: true,
      profiles: true
    }
  });

  console.log("Tenant info:", tenant ? {
    id: tenant.id,
    profile_type: tenant.profile_type,
    name: tenant.profiles?.name
  } : "Null");

  console.log("\nIdentification Documents:");
  console.log(JSON.stringify(tenant?.identification_documents, null, 2));

  console.log("\nAgreements:");
  console.log(JSON.stringify(tenant?.agreements, null, 2));
}

main()
  .catch((err) => console.error(err))
  .finally(() => prisma.$disconnect());
