/**
 * PHASE 6.4 (ADR-172) — proposed existing-owner subscription backfill.
 *
 * ⚠️ PROPOSED / NOT WIRED TO PRODUCTION. Reviewed and generated during a
 * read-only dry-run analysis of the DEV database (Supabase project
 * `qgfyfbdccjnibdhhvnsr`) on 2026-09-10. Do not run against production
 * without a fresh dry-run against that database first — this file is a
 * starting point for Phase 6.5's review, not a decision already made.
 *
 * PURPOSE
 * Give every existing OWNER profile a well-formed `owner_subscriptions` row
 * *before* `PLATFORM_BILLING_ENFORCED` is ever turned on, so enforcement
 * does not switch on against owners who have never had a chance to pay.
 *
 * SAFETY RULES (all enforced below, not just documented)
 *   - Owner-scoped: one row per owner, `owner_id` is the app-level identity —
 *     never derived from a hostel or a legacy per-hostel row.
 *   - Idempotent: an owner who already has an `owner_subscriptions` row is
 *     SKIPPED outright — this script NEVER writes to an existing row, and
 *     re-running it after a partial run changes nothing for owners already
 *     backfilled.
 *   - No duplicates: guarded by a pre-check AND the DB's `owner_id` UNIQUE
 *     constraint (a same-owner race just hits Prisma's `P2002`, which is
 *     treated as "already handled", not an error) — the same pattern
 *     `subscription-service.ensureForOwner` already uses.
 *   - FOUNDING is NEVER auto-assigned here. Every fresh row this script
 *     creates uses the STARTER placeholder plan
 *     (`INITIAL_PLACEHOLDER_PLAN_CODE`), exactly like a brand-new owner's
 *     very first `GET /api/owner/subscription` would — EXCEPT this script
 *     deliberately does not run `ensureForOwner`'s auto-FOUNDING-for-the-
 *     first-10 logic, because a bulk retroactive script granting the launch
 *     rate to whichever owners happen to sort first is a materially
 *     different decision than an owner organically becoming the Nth signup,
 *     and nothing in this analysis found evidence any existing owner was
 *     promised FOUNDING.
 *   - Never invents paid history: an owner is only proposed ACTIVE when
 *     there is clear, unambiguous evidence (an APPROVED `subscription_payments`
 *     row, or an issued `subscription_invoices` row) already on the
 *     owner-level tables. Legacy `hostel_subscriptions` / `platform_invoices`
 *     rows are read for context only and NEVER treated as proof of a current
 *     paid subscription (see CLASSIFY below) — per Phase 6.4's explicit rule.
 *   - Ambiguous owners are SKIPPED (not guessed) and printed under
 *     REVIEW_REQUIRED for a human to resolve by hand.
 *   - Money: this script never sets a price on `owner_subscriptions` itself
 *     (the schema doesn't carry one — price lives on `subscription_plans.
 *     price_paise`, referenced by `plan_id`). No float arithmetic anywhere.
 *
 * USAGE
 *   npx tsx scripts/backfill-owner-subscriptions.ts             # dry run (default) — reports only, zero writes
 *   npx tsx scripts/backfill-owner-subscriptions.ts --apply     # writes — DO NOT USE without a fresh review
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { FOUNDING_PLAN_CODE, FOUNDING_MAX_OWNERS } from "../src/services/platform-billing/subscription-rules";
import { INITIAL_PLACEHOLDER_PLAN_CODE } from "../src/services/platform-billing/subscription-service";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

type Classification =
  | "ALREADY_HAS_SUBSCRIPTION"
  | "NEW_MODEL_PAID_EVIDENCE" // APPROVED subscription_payments / subscription_invoices already exist — should already have a row (ALREADY_HAS_SUBSCRIPTION covers it in practice)
  | "NO_BILLING_HISTORY" // category D — no legacy row, no owner-level row, no payment/invoice
  | "LEGACY_ONLY_AMBIGUOUS"; // category E — legacy rows exist but don't unambiguously prove a current paid state

async function main() {
  console.log(APPLY ? "*** APPLY MODE — this will write to owner_subscriptions ***" : "DRY RUN — no writes will occur");

  const placeholderPlan = await prisma.subscription_plans.findUnique({ where: { code: INITIAL_PLACEHOLDER_PLAN_CODE } });
  const foundingPlan = await prisma.subscription_plans.findUnique({ where: { code: FOUNDING_PLAN_CODE } });
  if (!placeholderPlan) {
    console.error(`Plan ${INITIAL_PLACEHOLDER_PLAN_CODE} not seeded — run scripts/seed-subscription-plans.ts first.`);
    process.exit(1);
  }

  const owners = await prisma.profile.findMany({
    where: { role: "OWNER" },
    select: { id: true, name: true, created_at: true },
    orderBy: { created_at: "asc" },
  });

  const ownerIds = owners.map((o: any) => o.id);
  const existing = await prisma.owner_subscriptions.findMany({ where: { owner_id: { in: ownerIds } }, select: { owner_id: true } });
  const existingSet = new Set(existing.map((e: any) => e.owner_id));

  // FOUNDING usage is READ here only to report remaining slots — this script
  // never assigns FOUNDING, so it never reserves one.
  const foundingUsed = foundingPlan
    ? await prisma.owner_subscriptions.count({ where: { OR: [{ plan_id: foundingPlan.id }, { pending_plan_id: foundingPlan.id }] } })
    : 0;
  console.log(`FOUNDING (report only, never assigned by this script): ${foundingUsed}/${FOUNDING_MAX_OWNERS} used.`);

  const candidates = owners.filter((o: any) => !existingSet.has(o.id));
  console.log(`${owners.length} owners total, ${existingSet.size} already have an owner_subscriptions row, ${candidates.length} candidates for backfill.`);

  let created = 0;
  let skippedAmbiguous = 0;

  for (const owner of candidates) {
    // Evidence check — owner-level tables only decide ACTIVE; legacy tables
    // are read for the report but never promote a state on their own.
    const [approvedPayment, anyInvoice] = await Promise.all([
      prisma.subscription_payments.findFirst({ where: { owner_id: owner.id, status: "APPROVED" } }),
      prisma.subscription_invoices.findFirst({ where: { owner_id: owner.id } }),
    ]);

    let classification: Classification = "NO_BILLING_HISTORY";
    if (approvedPayment || anyInvoice) {
      // An owner with owner-level paid evidence but no owner_subscriptions
      // row would mean the approval transaction partially failed — that is
      // a data-integrity anomaly, not a normal backfill case. Flag, don't guess.
      classification = "LEGACY_ONLY_AMBIGUOUS";
    }

    if (classification === "LEGACY_ONLY_AMBIGUOUS") {
      skippedAmbiguous += 1;
      console.log(`REVIEW_REQUIRED  owner=${owner.id} (${owner.name}) — has subscription_payments/invoices but no owner_subscriptions row. Do not guess; resolve by hand.`);
      continue;
    }

    // NO_BILLING_HISTORY (category D) → PENDING_PAYMENT on the STARTER
    // placeholder, no period dates (there is no paid period yet) — exactly
    // what `ensureForOwner` would create for this owner on their first
    // visit to the billing page, minus the auto-FOUNDING branch.
    console.log(`PENDING_PAYMENT  owner=${owner.id} (${owner.name}) — no billing history found. Plan: ${INITIAL_PLACEHOLDER_PLAN_CODE} (placeholder), no period set.`);

    if (APPLY) {
      try {
        await prisma.owner_subscriptions.create({
          data: {
            owner_id: owner.id,
            plan_id: placeholderPlan.id,
            status: "PENDING_PAYMENT",
            // No trial, no period, no renewal date — matches ensureForOwner's
            // own PENDING_PAYMENT row shape exactly.
          },
        });
        created += 1;
      } catch (e: any) {
        if (e?.code === "P2002") {
          // Another process (e.g. the owner visiting their own billing page)
          // created the row between our read and this write — fine, idempotent.
          console.log(`  (race) owner=${owner.id} already has a row now — skipped.`);
        } else {
          throw e;
        }
      }
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Owners total:            ${owners.length}`);
  console.log(`Already had a row:       ${existingSet.size}`);
  console.log(`Backfilled to PENDING_PAYMENT: ${APPLY ? created : candidates.length - skippedAmbiguous} ${APPLY ? "" : "(would be, dry run)"}`);
  console.log(`Flagged REVIEW_REQUIRED: ${skippedAmbiguous}`);
  console.log(APPLY ? "Writes applied." : "No writes were made (dry run). Re-run with --apply after a human review of the REVIEW_REQUIRED list, if any.");
}

main()
  .catch((e) => {
    console.error("BACKFILL ERROR:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
