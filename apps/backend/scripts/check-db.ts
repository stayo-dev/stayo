import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Fetching users/profiles...");
  const profiles = await prisma.profile.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
    }
  });
  console.log("Profiles in DB:", JSON.stringify(profiles, null, 2));

  console.log("\nFetching hostels...");
  const hostels = await prisma.hostels.findMany({
    select: {
      id: true,
      name: true,
      owner_id: true,
      is_active: true,
    }
  });
  console.log("Hostels in DB:", JSON.stringify(hostels, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
