import * as dotenv from "dotenv";
import path from "path";
import fs from "fs";

const envPath = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: envPath });

async function main() {
  const dbModule = await import("../lib/db");
  const prisma = dbModule.prisma;
  
  console.log("Fetching profiles from DB...");
  const profiles = await prisma.profile.findMany({
    take: 10,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      created_at: true
    }
  });
  console.log("Profiles list:");
  console.log(JSON.stringify(profiles, null, 2));

  // Find some tenant/room mapping if possible
  const tenants = await prisma.tenant.findMany({
    take: 5,
    include: {
      profiles: { select: { name: true, email: true } },
      room_allocations: {
        where: { is_active: true },
        include: { room: { select: { room_no: true } } }
      }
    }
  });
  console.log("Tenants list:");
  console.log(JSON.stringify(tenants, null, 2));
}

main()
  .catch((e) => {
    console.error("Error fetching profiles:", e);
  });
