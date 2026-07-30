import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$queryRaw`
    SELECT
      'room_allocations'  AS entity, COUNT(*) FILTER (WHERE hostel_id IS NULL) AS null_count, COUNT(*) AS total FROM public.room_allocations
    UNION ALL SELECT
      'rent_obligations', COUNT(*) FILTER (WHERE hostel_id IS NULL), COUNT(*) FROM public.rent_obligations
    UNION ALL SELECT
      'payments',         COUNT(*) FILTER (WHERE hostel_id IS NULL), COUNT(*) FROM public.payments
    UNION ALL SELECT
      'receipts',         COUNT(*) FILTER (WHERE hostel_id IS NULL), COUNT(*) FROM public.receipts
    UNION ALL SELECT
      'reminder_logs',    COUNT(*) FILTER (WHERE hostel_id IS NULL), COUNT(*) FROM public.reminder_logs
    UNION ALL SELECT
      'tenants',          COUNT(*) FILTER (WHERE hostel_id IS NULL), COUNT(*) FROM public.tenants
    ORDER BY entity;
  `;
  console.log(result);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
