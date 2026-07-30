import { prisma } from "../lib/db";

async function main() {
  try {
    const columns: any[] = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'rooms'
    `;
    console.log(`\n=== ROOMS COLUMN DEFINITIONS ===`);
    columns.forEach(col => {
      console.log(`- ${col.column_name}: ${col.data_type}, Nullable: ${col.is_nullable}, Default: ${col.column_default}`);
    });
  } catch (err: any) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
