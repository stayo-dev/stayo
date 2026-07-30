import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
import { prisma } from "../lib/db";

const OWNER_ID = "c39676a0-c867-4435-9660-a060b8bceab6";

async function main() {
  // Search ALL profiles for bhargav
  const allProfiles = await prisma.profile.findMany({
    where: { name: { contains: "hargav", mode: "insensitive" } },
    select: { id: true, name: true, email: true, phone: true, role: true },
  });
  console.log("=== Profiles matching 'hargav' ===");
  console.log(JSON.stringify(allProfiles, null, 2));

  // Search ALL tenants in room G1
  const hostels = await prisma.hostels.findMany({ where: { owner_id: OWNER_ID }, select: { id: true, name: true } });
  const hostelIds = hostels.map((h: any) => h.id);
  const g1Rooms = await prisma.rooms.findMany({
    where: { hostel_id: { in: hostelIds }, room_no: "G1" },
    select: { id: true, room_no: true, hostel_id: true, capacity: true },
  });
  console.log("\n=== G1 Rooms ===");
  console.log(JSON.stringify(g1Rooms, null, 2));

  for (const room of g1Rooms) {
    const allocations = await prisma.roomAllocation.findMany({
      where: { room_id: room.id },
      include: {
        tenant: { include: { profiles: { select: { name: true, email: true } } } },
      },
    });
    console.log(`\n=== All allocations for G1 (${room.id}) ===`);
    for (const a of allocations) {
      console.log(`  ${a.tenant?.profiles?.name || "no profile"} | active=${a.is_active} | tenant_id=${a.tenant_id} | start=${a.start_date}`);
    }

    // Also check tenants with invitations to G1
    const invitations = await prisma.tenant_invitations.findMany({
      where: { room_id: room.id },
      select: { id: true, name: true, tenant_id: true, status: true, phone: true },
    });
    console.log(`\n=== Invitations for G1 ===`);
    for (const inv of invitations) {
      console.log(`  ${inv.name} | status=${inv.status} | tenant_id=${inv.tenant_id} | phone=${inv.phone}`);
    }
  }

  // Search all tenants with names containing "G" or "Bhargav"
  const allTenants = await prisma.tenants.findMany({
    where: { hostel_id: { in: hostelIds } },
    include: { profiles: { select: { name: true } } },
  });
  console.log("\n=== ALL tenant names ===");
  for (const t of allTenants) {
    console.log(`  ${t.profiles?.name || "NO PROFILE"} | id=${t.id} | status=${t.status}`);
  }

  // Inspect content_snapshot of first agreement
  const sampleAgreement = await prisma.agreement.findFirst({
    where: { hostel_id: { in: hostelIds } },
    select: { id: true, content_snapshot: true },
  });
  console.log("\n=== Sample content_snapshot keys ===");
  if (sampleAgreement?.content_snapshot) {
    const snap = sampleAgreement.content_snapshot as any;
    console.log(JSON.stringify(Object.keys(snap), null, 2));
    console.log("\n=== Full sample content_snapshot ===");
    console.log(JSON.stringify(snap, null, 2));
  }

  // Get Akshay's full data
  const akshay = await prisma.tenants.findUnique({
    where: { id: "d8f1f0f3-801f-425b-98a3-b706c0bf896c" },
    include: {
      agreements: { select: { id: true, status: true, agreement_start_date: true, agreement_end_date: true, agreement_duration_months: true, contract_rent: true, contract_security_deposit: true } },
      rent_obligations: { where: { is_superseded: false }, select: { id: true, rent_month: true, amount: true, status: true, agreement_id: true }, orderBy: { rent_month: "asc" } },
    },
  });
  console.log("\n=== Akshay full data ===");
  console.log(JSON.stringify({
    id: akshay?.id,
    monthly_rent: akshay?.monthly_rent,
    security_deposit: akshay?.security_deposit,
    joined_on: akshay?.joined_on,
    agreements: akshay?.agreements,
    obligations: akshay?.rent_obligations,
  }, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
