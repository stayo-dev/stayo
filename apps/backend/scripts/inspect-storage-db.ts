import { prisma } from "../lib/db";

async function main() {
  try {
    const buckets = await prisma.$queryRawUnsafe<any[]>(
      `select id, name, public from storage.buckets`
    );
    console.log("=== Storage Buckets (from DB) ===");
    console.log(JSON.stringify(buckets, null, 2));

    const objectsCount = await prisma.$queryRawUnsafe<any[]>(
      `select count(*)::int as count from storage.objects`
    );
    console.log(`=== Storage Objects Count: ${objectsCount[0]?.count || 0} ===`);

    if (objectsCount[0]?.count > 0) {
      const objects = await prisma.$queryRawUnsafe<any[]>(
        `select id, bucket_id, name, metadata from storage.objects limit 20`
      );
      console.log("=== Sample Storage Objects ===");
      console.log(JSON.stringify(objects, null, 2));
    }
  } catch (err) {
    console.error("Failed to query storage schema in DB:", err);
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
