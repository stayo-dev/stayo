import { prisma } from "../lib/db";

async function main() {
  try {
    const tenants = await prisma.tenants.findMany({
      where: {
        profiles: {
          name: {
            contains: "Shiva",
            mode: "insensitive"
          }
        }
      },
      include: {
        profiles: true,
        move_out_requests: true,
        room_allocations: {
          include: {
            room: true
          }
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
