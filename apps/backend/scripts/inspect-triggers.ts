import { prisma } from "../lib/db";

async function main() {
  const triggers = await prisma.$queryRawUnsafe<any[]>(
    `select 
       tgname as trigger_name, 
       tgrelid::regclass::text as table_name,
       tgtype,
       tgenabled
     from pg_trigger 
     where tgisinternal = false`
  );
  console.log("=== Triggers in Database ===");
  console.log(JSON.stringify(triggers, null, 2));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
