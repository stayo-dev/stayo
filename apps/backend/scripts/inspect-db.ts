import { prisma } from "../lib/db";

async function main() {
  const requests = await prisma.move_out_requests.findMany({
    include: {
      tenant: {
        select: {
          id: true,
          status: true,
          profiles: { select: { name: true } },
          room_allocations: { select: { id: true, is_active: true } }
        }
      }
    }
  });

  console.log("=== Move-Out Requests ===");
  for (const r of requests) {
    console.log({
      id: r.id,
      tenantName: r.tenant?.profiles?.name,
      tenantStatus: r.tenant?.status,
      requestStatus: r.status,
      roomReleaseDate: r.room_release_date,
      physicalExitDate: r.physical_exit_date,
      plannedExitDate: r.planned_exit_date,
      roomAllocations: r.tenant?.room_allocations
    });
  }
}

main().catch(console.error);
