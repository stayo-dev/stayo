import { PrismaClient } from "@prisma/client";
import { receiptService } from "../src/services/payments/receipt-service";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

type RepairResult = {
  attempted: number;
  repaired: number;
  skipped: number;
  errors: Array<{ id: string; reason: string }>;
};

async function repairAttemptHostelScope(): Promise<RepairResult> {
  const result: RepairResult = { attempted: 0, repaired: 0, skipped: 0, errors: [] };
  const attempts = await prisma.paymentAttempt.findMany({
    where: {
      status: { notIn: ["FAILED", "EXPIRED", "CANCELLED"] },
      payment_domain: "RENT_COLLECTION",
      flow_type: { in: ["RENT", "ADVANCE", "FUTURE_RENT_CREDIT", "MANUAL_UPI_REFERENCE"] },
      hostel_id: null,
    },
    include: {
      payments: { select: { hostel_id: true } },
      rent_obligations: { select: { hostel_id: true } },
      obligations: { include: { rent_obligations: { select: { hostel_id: true } } } },
    },
  });

  for (const attempt of attempts) {
    result.attempted++;
    const hostelIds = new Set<string>();
    attempt.payments.forEach((payment) => payment.hostel_id && hostelIds.add(payment.hostel_id));
    if (attempt.rent_obligations?.hostel_id) hostelIds.add(attempt.rent_obligations.hostel_id);
    attempt.obligations.forEach((link) => link.rent_obligations?.hostel_id && hostelIds.add(link.rent_obligations.hostel_id));

    if (hostelIds.size !== 1) {
      result.skipped++;
      result.errors.push({ id: attempt.id, reason: `ambiguous hostel candidates: ${Array.from(hostelIds).join(",") || "none"}` });
      continue;
    }

    const hostelId = Array.from(hostelIds)[0];
    if (apply) {
      await prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          hostel_id: hostelId,
          scope_type: "HOSTEL",
          merchant_context_type: "OWNER_HOSTEL",
          merchant_context_id: hostelId,
        },
      });
    }
    result.repaired++;
  }

  return result;
}

async function repairMissingReceipts(): Promise<RepairResult> {
  const result: RepairResult = { attempted: 0, repaired: 0, skipped: 0, errors: [] };
  const payments = await prisma.payments.findMany({
    where: {
      receipts: null,
      created_at: { lt: new Date(Date.now() - 5 * 60 * 1000) },
    },
    select: { id: true },
    take: 1000,
  });

  for (const payment of payments) {
    result.attempted++;
    try {
      if (apply) await receiptService.createReceipt(payment.id);
      result.repaired++;
    } catch (error: any) {
      result.skipped++;
      result.errors.push({ id: payment.id, reason: error?.message || String(error) });
    }
  }

  return result;
}

async function main() {
  const [attemptHostelScope, missingReceipts] = await Promise.all([
    repairAttemptHostelScope(),
    repairMissingReceipts(),
  ]);

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    attempt_hostel_scope: attemptHostelScope,
    missing_receipts: missingReceipts,
  }, null, 2));

  if (!apply && (attemptHostelScope.attempted > 0 || missingReceipts.attempted > 0)) {
    process.exitCode = 1;
  }
  if (attemptHostelScope.errors.length > 0 || missingReceipts.errors.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("payment-dirty-data-repair failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
