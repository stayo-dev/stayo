import { prisma } from "../lib/db";

async function main() {
  try {
    const tenants = await prisma.tenants.findMany({
      where: {
        profiles: {
          name: {
            contains: "Shreyan",
            mode: "insensitive"
          }
        }
      },
      include: {
        profiles: true,
        hostels: true,
        room_allocations: {
          include: {
            room: true
          }
        },
        agreements: true,
        rent_obligations: {
          where: { is_superseded: false },
          orderBy: { rent_month: "asc" }
        }
      }
    });

    console.log(JSON.stringify(tenants, null, 2));
  } catch (err: any) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
