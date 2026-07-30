import { prisma } from "../lib/db";

async function main() {
  try {
    const tenants = await prisma.tenants.findMany({
      where: {
        profiles: {
          name: {
            contains: "Shiva",
          },
        },
      },
      include: {
        profiles: true,
        move_out_requests: true,
      },
    });
    console.log("Tenants matched:");
    console.log(JSON.stringify(tenants, null, 2));
  } catch (error: any) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
