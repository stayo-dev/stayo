/**
 * Seed / re-sync the Stayo subscription plan catalog (ADR-172).
 *
 * Canonical source of the plan values — the sibling migrations
 * (`20260909000000_owner_subscription_billing_phase1`,
 * `20260910010000_subscription_extra_beds`) mirror these for the manual
 * Supabase-apply path; keep them in sync.
 *
 * Idempotent: `upsert` by `code`. Re-running updates name / capacity / extra-bed
 * fields / public flag but, like the migrations' `ON CONFLICT`, this script does
 * NOT overwrite a `price_paise` an admin may have edited in production — pass
 * `--force-price` to also reset prices to the values below.
 *
 * Usage:
 *   npx tsx scripts/seed-subscription-plans.ts
 *   npx tsx scripts/seed-subscription-plans.ts --force-price
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Prices are integer paise. `included_beds` is what `price_paise` covers with
 * no extra charge; `max_extra_beds` is the ceiling on PAID extra beds beyond
 * that (`null` = no ceiling — FOUNDING only; `0` = not offered yet —
 * PORTFOLIO, see the note below); `extra_bed_price_paise` is the per-bed
 * price for those extra beds. `capacity_max` is kept as the plan's overall
 * hard ceiling (`included_beds + max_extra_beds`, or `null` when unlimited)
 * for every existing display/filter that already reads it.
 *
 * FOUNDING is the first-10-owners launch offer: non-public (never
 * owner-selectable), 250 included beds, and — unlike every other plan — NO
 * ceiling on paid extra beds. Auto-assigned to the first 10 owner accounts at
 * subscription creation (`subscriptionService.ensureForOwner`, ADR-173).
 *
 * PORTFOLIO: business rules (2026-09-10) explicitly did not define an
 * extra-bed allowance for this tier — `max_extra_beds: 0` and
 * `extra_bed_price_paise: null` are a deliberate placeholder ("not offered"),
 * not a guess. `capacity_max` keeps its existing value (500) unchanged. See
 * docs/obsidian/Business-Rules.md for the open item.
 */
const PLANS: Array<{
  code: string;
  name: string;
  price_paise: number;
  capacity_min: number;
  capacity_max: number | null;
  included_beds: number;
  max_extra_beds: number | null;
  extra_bed_price_paise: number | null;
  is_public: boolean;
}> = [
  {
    code: "FOUNDING", name: "Founding", price_paise: 200000,
    capacity_min: 1, capacity_max: null,
    included_beds: 250, max_extra_beds: null, extra_bed_price_paise: 1000,
    is_public: false,
  },
  {
    code: "STARTER", name: "Starter", price_paise: 149900,
    capacity_min: 1, capacity_max: 60,
    included_beds: 50, max_extra_beds: 10, extra_bed_price_paise: 1000,
    is_public: true,
  },
  {
    code: "GROWTH", name: "Growth", price_paise: 249900,
    capacity_min: 51, capacity_max: 125,
    included_beds: 100, max_extra_beds: 25, extra_bed_price_paise: 1000,
    is_public: true,
  },
  {
    code: "PROFESSIONAL", name: "Professional", price_paise: 449900,
    capacity_min: 101, capacity_max: 300,
    included_beds: 250, max_extra_beds: 50, extra_bed_price_paise: 1000,
    is_public: true,
  },
  {
    code: "PORTFOLIO", name: "Portfolio", price_paise: 799900,
    capacity_min: 251, capacity_max: 500,
    // BUSINESS DECISION REQUIRED: no extra-bed allowance defined for
    // Portfolio yet. `0` deliberately disables extra-bed purchase on this
    // plan rather than inventing a number — see docs/obsidian/Business-Rules.md.
    included_beds: 500, max_extra_beds: 0, extra_bed_price_paise: null,
    is_public: true,
  },
] as const;

async function main() {
  const forcePrice = process.argv.includes("--force-price");

  for (const plan of PLANS) {
    const common = {
      name: plan.name,
      currency: "INR",
      billing_cycle: "MONTHLY" as const,
      capacity_min: plan.capacity_min,
      capacity_max: plan.capacity_max,
      included_beds: plan.included_beds,
      max_extra_beds: plan.max_extra_beds,
      extra_bed_price_paise: plan.extra_bed_price_paise,
      is_public: plan.is_public,
      is_active: true,
      // Mirror into the deprecated Decimal column so the legacy per-hostel admin
      // routes (which order by `price_amount`) keep working during the transition.
      price_amount: plan.price_paise / 100,
      updated_at: new Date(),
    };

    await prisma.subscription_plans.upsert({
      where: { code: plan.code },
      create: { code: plan.code, price_paise: plan.price_paise, ...common },
      update: forcePrice ? { price_paise: plan.price_paise, ...common } : common,
    });

    const cap = plan.capacity_max === null ? `${plan.capacity_min}+ (unlimited)` : `${plan.capacity_min}-${plan.capacity_max}`;
    const extra =
      plan.max_extra_beds === null
        ? "unlimited extra beds"
        : plan.max_extra_beds === 0
          ? "no extra beds"
          : `up to ${plan.max_extra_beds} extra @ ₹${(plan.extra_bed_price_paise ?? 0) / 100}/bed`;
    console.log(
      `  ✓ ${plan.code.padEnd(13)} ₹${(plan.price_paise / 100).toLocaleString("en-IN")}/mo  cap ${cap}  ${plan.included_beds} included, ${extra}${plan.is_public ? "" : "  (non-public)"}`,
    );
  }

  console.log(`\nSeeded ${PLANS.length} plans${forcePrice ? " (prices forced)" : ""}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
