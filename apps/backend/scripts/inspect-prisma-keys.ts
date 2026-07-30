import { prisma } from "../lib/db";

async function main() {
  const keys = Object.keys(prisma);
  console.log("All prisma model keys:", keys.filter(k => !k.startsWith('_') && !k.startsWith('$')));
}

main();

