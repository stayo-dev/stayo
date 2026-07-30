import { prisma } from "@/lib/db";
import { agreementRentScheduleService } from "@/src/services/payments/agreement-rent-schedule-service";

const apply = process.argv.includes("--apply");

async function main() {
  const agreements = await prisma.agreement.findMany({
    where: {
      status: { in: ["SIGNED", "EXPIRING_SOON", "AGREEMENT_EXPIRED"] },
      agreement_duration_months: { gt: 0 },
    },
    select: {
      id: true,
      tenant_id: true,
      agreement_duration_months: true,
      agreement_start_date: true,
      rent_obligations: {
        where: { obligation_type: "RENT", is_superseded: false },
        select: { id: true },
      },
    },
    orderBy: { generated_at: "asc" },
  });

  const candidates = agreements.filter((agreement: any) => {
    const expected = Number(agreement.agreement_duration_months || 0);
    return expected > 0 && agreement.rent_obligations.length < expected;
  });

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    signed_agreements: agreements.length,
    candidates: candidates.length,
    candidate_agreement_ids: candidates.map((agreement: any) => agreement.id),
  }, null, 2));

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to create/link missing agreement rent obligations.");
    return;
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const agreement of candidates) {
    const result = await agreementRentScheduleService.generateForAgreement(agreement.id);
    created += result.created;
    updated += result.updated;
    skipped += result.skipped;
    console.log(JSON.stringify({ agreement_id: agreement.id, ...result }));
  }

  console.log(JSON.stringify({ done: true, created, updated, skipped }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
