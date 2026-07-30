import { prisma } from "../lib/db";

async function main() {
  try {
    const users = await prisma.profile.findMany();
    console.log("=== ALL USER PROFILES ===");
    console.log(users.map(u => ({ id: u.id, email: u.email, role: u.role, name: u.name })));
  } catch (err: any) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
