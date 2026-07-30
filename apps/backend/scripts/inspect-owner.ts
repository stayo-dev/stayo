import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== INSPECTING PROFILES AND HOSTELS ===");

  const profiles = await prisma.profile.findMany({
    where: {
      role: "OWNER"
    },
    include: {
      hostels: true
    }
  });

  console.log(`Found ${profiles.length} owner profiles.`);
  for (const prof of profiles) {
    console.log(`- Profile ID: ${prof.id}`);
    console.log(`  Email: ${prof.email}`);
    console.log(`  Name: ${prof.name}`);
    console.log(`  Phone: ${prof.phone}`);
    console.log(`  Hostels owned:`);
    for (const hostel of prof.hostels) {
      console.log(`    * Hostel ID: ${hostel.id}`);
      console.log(`      Name: ${hostel.name}`);
      console.log(`      Status: ${hostel.status}`);
      console.log(`      Owner ID: ${hostel.owner_id}`);
    }
  }

  // Also query hostels table directly
  const allHostels = await prisma.hostels.findMany();
  console.log(`\nAll Hostels in DB: ${allHostels.length}`);
  for (const h of allHostels) {
    console.log(`- Hostel: ${h.name} (${h.id}) | Owner: ${h.owner_id} | Status: ${h.status}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
