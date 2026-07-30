import { prisma } from "../lib/db";

async function main() {
  try {
    const profiles = await prisma.profile.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });
    console.log("Profiles found in database:");
    console.log(JSON.stringify(profiles, null, 2));
  } catch (error: any) {
    console.error("Error fetching profiles:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
