import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const attempts = await prisma.paymentAttempt.findMany({
    orderBy: { created_at: "desc" },
    take: 5,
    select: {
      id: true,
      tenant_id: true,
      hostel_id: true,
      amount: true,
      status: true,
      payment_type: true,
      created_at: true,
      raw_create_response: true
    }
  });
  console.log("Recent Payment Attempts:", JSON.stringify(attempts, null, 2));

  const tenants = await prisma.tenants.findMany({
    select: {
      id: true,
      hostel_id: true,
      status: true,
      profiles: {
        select: {
          name: true
        }
      }
    }
  });
  console.log("Tenants:", JSON.stringify(tenants, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
