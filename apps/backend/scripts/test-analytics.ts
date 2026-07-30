import { prisma } from "../lib/db";
import { admissionsService } from "../src/services/admissions/admissions-service";

async function main() {
  const profile = await prisma.profile.findFirst();
  if (!profile) {
    console.error("No profile found");
    return;
  }
  console.log("Using profile owner_id:", profile.id);
  try {
    const res = await admissionsService.analytics(profile.id, {});
    console.log("Analytics result keys:", Object.keys(res));
  } catch (err) {
    console.error("Error executing analytics:", err);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
