import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { prisma } from "../lib/db";

async function main() {
  const tenants = await prisma.tenants.findMany({
    include: {
      profiles: true
    }
  });

  console.log("Tenants in DB:", tenants.map((t: any) => ({
    id: t.id,
    name: t.profiles?.name,
    phone: t.profiles?.phone,
    guardian_phone: t.guardian_phone,
    personal_email: t.personal_email,
    status: t.status
  })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
