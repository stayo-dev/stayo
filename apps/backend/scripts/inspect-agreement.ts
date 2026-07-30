import { prisma } from "../lib/db";

async function main() {
  const docId = "858bc8ec-29bb-416c-b66a-1c9e83a9311e";
  const agreement = await prisma.agreement.findUnique({
    where: { id: docId },
    include: {
      tenant: {
        include: {
          profiles: true,
          room_allocations: { include: { room: true } }
        }
      }
    }
  });
  console.log("Agreement details:", JSON.stringify(agreement, null, 2));
}

main()
  .catch((err) => console.error(err))
  .finally(() => prisma.$disconnect());
