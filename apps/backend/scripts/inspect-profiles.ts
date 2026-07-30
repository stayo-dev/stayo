import { prisma } from "../lib/db";

async function main() {
  try {
    const authUsers = await prisma.$queryRawUnsafe<any[]>(
      `select id, email, phone from auth.users`
    );
    console.log("=== Auth Users in auth.users ===");
    console.log(JSON.stringify(authUsers, null, 2));
  } catch (err) {
    console.error("Failed to query auth.users:", err);
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
