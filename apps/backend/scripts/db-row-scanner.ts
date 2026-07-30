import { prisma } from "../lib/db";

function quoteIdent(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function countTable(table: string) {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `select count(*)::bigint as count from ${quoteIdent(table)}`
    );
    return Number(rows[0]?.count || 0);
  } catch (err) {
    console.error(`Failed to count table ${table}:`, err);
    return -1;
  }
}

async function main() {
  const tableRows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `select tablename
     from pg_tables
     where schemaname = 'public'
       and tablename not in ('_prisma_migrations')
     order by tablename`
  );
  
  const results: { table: string; count: number }[] = [];
  
  for (const row of tableRows) {
    const count = await countTable(row.tablename);
    results.push({ table: row.tablename, count });
  }

  // Print results as JSON
  console.log(JSON.stringify(results, null, 2));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
