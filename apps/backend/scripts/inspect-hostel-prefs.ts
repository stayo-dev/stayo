import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const hostels = await prisma.hostels.findMany({
    select: {
      id: true,
      name: true,
      is_active: true,
      preferences_config: true
    }
  });
  console.log("Hostels:", JSON.stringify(hostels, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
