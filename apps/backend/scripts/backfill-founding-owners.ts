/**
 * One-off backfill: place existing early owners on the FOUNDING plan (ADR-172).
 *
 * The "first 10 owners get FOUNDING automatically" rule is now enforced at
 * subscription creation (`ensureForOwner`). Owners whose `owner_subscriptions`
 * row was created *before* that change were auto-placed on the STARTER
 * placeholder instead. This script moves those rows onto FOUNDING, oldest
 * first, while first-10 slots remain.
 *
 * Only touches rows that are safe to change:
 *   - status = PENDING_PAYMENT (never activated / paid)
 *   - currently on the STARTER placeholder plan
 *   - the owner has NO subscription_payments row in SUBMITTED / UNDER_REVIEW /
 *     APPROVED (a rejected-only history is fine)
 *
 * Non-destructive, idempotent, dry-run by default.
 *
 *   npx tsx scripts/backfill-founding-owners.ts            # dry run, reports only
 *   npx tsx scripts/backfill-founding-owners.ts --apply    # writes
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  FOUNDING_PLAN_CODE,
  FOUNDING_MAX_OWNERS,
} from "../src/services/platform-billing/subscription-rules";
import { INITIAL_PLACEHOLDER_PLAN_CODE } from "../src/services/platform-billing/subscription-service";

const APPLY = process.argv.includes("--apply");
const BLOCKING_PAYMENT_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "APPROVED"];

const prisma = new PrismaClient();

async function main() {
  try {
    const [foundingPlan, starterPlan] = await Promise.all([
      prisma.subscription_plans.findUnique({ where: { code: FOUNDING_PLAN_CODE } }),
      prisma.subscription_plans.findUnique({ where: { code: INITIAL_PLACEHOLDER_PLAN_CODE } }),
    ]);
    if (!foundingPlan || !starterPlan) {
      console.error("FOUNDING or STARTER plan not configured — run scripts/seed-subscription-plans.ts first.");
      process.exit(1);
    }

    const used = await prisma.owner_subscriptions.count({
      where: { OR: [{ plan_id: foundingPlan.id }, { pending_plan_id: foundingPlan.id }] },
    });
    const slots = FOUNDING_MAX_OWNERS - used;
    console.log(`FOUNDING slots: ${used}/${FOUNDING_MAX_OWNERS} used, ${Math.max(0, slots)} free.`);
    if (slots <= 0) {
      console.log("No free slots — nothing to backfill.");
      return;
    }

    const candidates = await prisma.owner_subscriptions.findMany({
      where: { status: "PENDING_PAYMENT", plan_id: starterPlan.id },
      orderBy: { created_at: "asc" },
    });

    const toMove: string[] = [];
    for (const sub of candidates) {
      if (toMove.length >= slots) break;
      const blocking = await prisma.subscription_payments.count({
        where: { owner_id: sub.owner_id, status: { in: BLOCKING_PAYMENT_STATUSES as any } },
      });
      if (blocking > 0) {
        console.log(`  skip owner ${sub.owner_id} — has a payment in review/approved`);
        continue;
      }
      toMove.push(sub.id);
      console.log(`  ${APPLY ? "MOVE" : "would move"} subscription ${sub.id} (owner ${sub.owner_id}) → FOUNDING`);
    }

    if (toMove.length === 0) {
      console.log("No eligible PENDING_PAYMENT owners on the STARTER placeholder.");
      return;
    }

    if (!APPLY) {
      console.log(`\nDry run: ${toMove.length} subscription(s) would move to FOUNDING. Re-run with --apply to write.`);
      return;
    }

    const result = await prisma.owner_subscriptions.updateMany({
      where: { id: { in: toMove } },
      data: { plan_id: foundingPlan.id, updated_at: new Date() },
    });
    console.log(`\nMoved ${result.count} subscription(s) to FOUNDING.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
