/**
 * Owner subscription service (ADR-172, Phase 2).
 *
 * Owns the ONE-subscription-per-owner guarantee, the plan catalogue an owner
 * may see, and the transaction-safe FOUNDING first-10-owners cap. It never
 * accepts an ownerId from request input — callers pass the id resolved from the
 * authenticated session.
 *
 * Payment submission and admin review live in `subscription-payment-service.ts`.
 */
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { SubscriptionError } from "./subscription-errors";
import {
  FOUNDING_PLAN_CODE,
  FOUNDING_MAX_OWNERS,
  CURRENCY,
} from "./subscription-rules";

/**
 * Stayo has NO trial period — a new owner must pay before they can actively use
 * the platform. A subscription is created in PENDING_PAYMENT. The initial
 * `plan_id` is a placeholder (the entry plan); the real plan is whatever the
 * owner's first approved payment selects.
 */
export const INITIAL_PLACEHOLDER_PLAN_CODE = "STARTER";

/**
 * A stable key for `pg_advisory_xact_lock`, so every concurrent FOUNDING
 * assignment serialises on the same lock for the duration of its transaction.
 * (Within Number.MAX_SAFE_INTEGER — passed as a plain integer.)
 */
const FOUNDING_LOCK_KEY = 172_000_000_010;

/** Prisma is exported as `any` (lib/db.ts) — the repo types transaction clients as `any`. */
type Tx = any;

async function requirePlanByCode(code: string) {
  const plan = await prisma.subscription_plans.findUnique({ where: { code } });
  if (!plan) {
    throw new SubscriptionError(`Plan "${code}" is not configured — run scripts/seed-subscription-plans.ts.`, "PLAN_NOT_CONFIGURED", 500);
  }
  return plan;
}

/**
 * The owner's subscription, creating a PENDING_PAYMENT one the first time
 * this is called so the rest of the flow always has a row to attach a
 * payment to. Stayo has NO trial — the owner cannot actively use the
 * platform until an admin approves their first payment. Exactly one row can
 * ever exist per owner (`owner_id` UNIQUE) — a lost create race surfaces as
 * P2002 and we re-read.
 *
 * The FIRST 10 owner accounts to complete onboarding are placed on FOUNDING
 * automatically at this point — the plan is never owner-selectable. The slot
 * is claimed atomically (advisory lock + count inside one transaction, same
 * key as `reserveFoundingSlotInTx`), so concurrent calls cannot both read "9
 * used" and both take the 10th slot. Once the 10 slots are gone, new owners
 * fall back to the STARTER placeholder — they still need an admin-confirmed
 * payment either way, only the pre-assigned plan differs.
 *
 * PRIMARY caller (2026-09-12, Founding-onboarding fix): the owner's first
 * hostel creation (`POST /api/owner/hostels` and
 * `hostelProvisioningService.provision`) — that is the existing, canonical
 * "owner completed onboarding" signal already used by the lead-acquisition
 * funnel (`markHostelCreated`), so Founding rank is pinned to the moment
 * onboarding actually completes, not to whenever the owner happens to open
 * the Subscription page. `getForOwner` below still calls this too, but ONLY
 * as a defensive fallback (e.g. a pre-existing owner from before this hook
 * existed, or the hostel-creation call failing) — it must never be the
 * mechanism a normal owner's Founding slot is decided by.
 */
async function ensureForOwner(ownerId: string) {
  const existing = await prisma.owner_subscriptions.findUnique({ where: { owner_id: ownerId } });
  if (existing) return existing;

  const [placeholderPlan, foundingPlan] = await Promise.all([
    requirePlanByCode(INITIAL_PLACEHOLDER_PLAN_CODE),
    prisma.subscription_plans.findUnique({ where: { code: FOUNDING_PLAN_CODE } }),
  ]);

  try {
    const created = await prisma.$transaction(async (tx: Tx) => {
      let planId = placeholderPlan.id;

      if (foundingPlan) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FOUNDING_LOCK_KEY})`;
        const used = await tx.owner_subscriptions.count({
          where: { OR: [{ plan_id: foundingPlan.id }, { pending_plan_id: foundingPlan.id }] },
        });
        if (used < FOUNDING_MAX_OWNERS) planId = foundingPlan.id;
      }

      return tx.owner_subscriptions.create({
        data: {
          owner_id: ownerId,
          plan_id: planId,
          status: "PENDING_PAYMENT",
        },
      });
    });

    await eventLog.log("SUBSCRIPTION_CREATED", ownerId, {
      subscription_id: created.id,
      status: "PENDING_PAYMENT",
      plan_code: foundingPlan && created.plan_id === foundingPlan.id ? FOUNDING_PLAN_CODE : INITIAL_PLACEHOLDER_PLAN_CODE,
    });
    return created;
  } catch (e: any) {
    if (e?.code === "P2002") {
      const raced = await prisma.owner_subscriptions.findUnique({ where: { owner_id: ownerId } });
      if (raced) return raced;
    }
    throw e;
  }
}

/**
 * 1–10 if `planId` is the owner's CURRENT plan and it is FOUNDING, else
 * `null`. Rank is derived, not stored — the Nth-earliest `created_at` among
 * rows currently on FOUNDING (allocation order is already correct because
 * `ensureForOwner`/`reserveFoundingSlotInTx` serialise on the advisory lock,
 * so the row that wins the lock first is the row created first). A
 * downgraded-away owner simply falls out of the ranking.
 */
async function foundingPartnerNumber(planId: string | null, createdAt: Date): Promise<number | null> {
  if (!planId) return null;
  const foundingPlan = await prisma.subscription_plans.findUnique({ where: { code: FOUNDING_PLAN_CODE }, select: { id: true } });
  if (!foundingPlan || planId !== foundingPlan.id) return null;
  return prisma.owner_subscriptions.count({
    where: { plan_id: foundingPlan.id, created_at: { lte: createdAt } },
  });
}

/** Full read model for the owner's own subscription screen. Owner-scoped by construction. */
async function getForOwner(ownerId: string) {
  const subscription = await ensureForOwner(ownerId);

  const { planCapacityService } = await import("./plan-capacity-service");
  const [plan, pendingPlan, payments, invoices, capacity, foundingNumber] = await Promise.all([
    prisma.subscription_plans.findUnique({ where: { id: subscription.plan_id } }),
    subscription.pending_plan_id
      ? prisma.subscription_plans.findUnique({ where: { id: subscription.pending_plan_id } })
      : Promise.resolve(null),
    prisma.subscription_payments.findMany({
      where: { owner_id: ownerId },
      orderBy: { created_at: "desc" },
      take: 20,
    }),
    prisma.subscription_invoices.findMany({
      where: { owner_id: ownerId },
      orderBy: { issued_at: "desc" },
      take: 20,
      include: { subscription_payments: { select: { subscription_plans: { select: { name: true } } } } },
    }),
    // Backend is the source of truth for usage vs capacity — the frontend
    // never recomputes this (ADR-172).
    planCapacityService.getCapacityStatus(ownerId).catch(() => null),
    foundingPartnerNumber(subscription.plan_id, subscription.created_at),
  ]);

  return {
    subscription: {
      id: subscription.id,
      status: subscription.status,
      founding_partner_number: foundingNumber,
      plan: plan
        ? {
            id: plan.id,
            code: plan.code,
            name: plan.name,
            price_paise: plan.price_paise,
            currency: plan.currency,
            capacity_max: plan.capacity_max,
            included_beds: plan.included_beds,
            max_extra_beds: plan.max_extra_beds,
            extra_bed_price_paise: plan.extra_bed_price_paise,
          }
        : null,
      // Currently active PAID extra beds (business rules, 2026-09-10) — 0 for
      // every owner who hasn't bought any.
      extra_beds: subscription.extra_beds,
      pending_plan: pendingPlan
        ? { id: pendingPlan.id, code: pendingPlan.code, name: pendingPlan.name, price_paise: pendingPlan.price_paise }
        : null,
      trial_ends_at: subscription.trial_ends_at,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      next_renewal_at: subscription.next_renewal_at,
      started_at: subscription.started_at,
      cancelled_at: subscription.cancelled_at,
    },
    payments: payments.map((p: any) => ({
      id: p.id,
      plan_id: p.plan_id,
      amount_paise: p.amount_paise,
      extra_beds: p.extra_beds,
      currency: p.currency,
      payment_method: p.payment_method,
      transaction_reference: p.transaction_reference,
      status: p.status,
      rejection_reason: p.rejection_reason,
      submitted_at: p.submitted_at,
      reviewed_at: p.reviewed_at,
    })),
    invoices: invoices.map((inv: any) => ({
      id: inv.id,
      invoice_number: inv.invoice_number,
      plan_name: inv.subscription_payments?.subscription_plans?.name ?? null,
      amount_paise: inv.amount_paise,
      extra_beds: inv.extra_beds,
      plan_amount_paise: inv.plan_amount_paise,
      extra_bed_unit_price_paise: inv.extra_bed_unit_price_paise,
      extra_bed_amount_paise: inv.extra_bed_amount_paise,
      tax_paise: inv.tax_paise,
      currency: inv.currency,
      billing_period_start: inv.billing_period_start,
      billing_period_end: inv.billing_period_end,
      payment_method: inv.payment_method,
      issued_at: inv.issued_at,
      // The PDF is downloaded through GET /api/owner/subscription/invoices/[id],
      // never via this URL directly (access control is enforced on each fetch).
      // `document_ready` just tells the UI whether the file has been generated.
      document_ready: Boolean(inv.document_url),
    })),
    /**
     * Active-tenant usage vs the current plan's ceiling. `capacity_max: null`
     * means unlimited (FOUNDING). Computed server-side; the frontend only
     * displays these numbers.
     */
    usage: capacity
      ? {
          plan_code: capacity.plan_code,
          used: capacity.active_count,
          capacity_max: capacity.capacity_max,
          available: capacity.available,
          at_limit: capacity.at_limit,
        }
      : null,
  };
}

/** How many owners currently hold FOUNDING, and whether a slot is free. */
async function foundingSlotStatus() {
  const foundingPlan = await prisma.subscription_plans.findUnique({ where: { code: FOUNDING_PLAN_CODE } });
  if (!foundingPlan) return { used: 0, max: FOUNDING_MAX_OWNERS, available: 0, plan: null as null };
  const used = await prisma.owner_subscriptions.count({
    where: { OR: [{ plan_id: foundingPlan.id }, { pending_plan_id: foundingPlan.id }] },
  });
  return {
    used,
    max: FOUNDING_MAX_OWNERS,
    available: Math.max(0, FOUNDING_MAX_OWNERS - used),
    plan: foundingPlan,
  };
}

/** Whether this owner may be put on FOUNDING right now (already-on counts as yes). */
async function canOwnerTakeFounding(ownerId: string): Promise<boolean> {
  const status = await foundingSlotStatus();
  if (!status.plan) return false;
  const alreadyOn = await prisma.owner_subscriptions.count({
    where: {
      owner_id: ownerId,
      OR: [{ plan_id: status.plan.id }, { pending_plan_id: status.plan.id }],
    },
  });
  return alreadyOn > 0 || status.available > 0;
}

/**
 * Reserve a FOUNDING slot for this owner INSIDE an open transaction.
 *
 * Takes a transaction-scoped advisory lock first, so two concurrent approvals
 * cannot both read "9 used" and both proceed. An owner already on FOUNDING
 * (renewal) does not consume a new slot.
 *
 * Throws `SubscriptionError('FOUNDING_FULL')` when all 10 slots are taken.
 */
async function reserveFoundingSlotInTx(tx: Tx, ownerId: string, foundingPlanId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FOUNDING_LOCK_KEY})`;

  const alreadyOn = await tx.owner_subscriptions.count({
    where: {
      owner_id: ownerId,
      OR: [{ plan_id: foundingPlanId }, { pending_plan_id: foundingPlanId }],
    },
  });
  if (alreadyOn > 0) return; // renewal — no new slot needed

  const used = await tx.owner_subscriptions.count({
    where: { OR: [{ plan_id: foundingPlanId }, { pending_plan_id: foundingPlanId }] },
  });
  if (used >= FOUNDING_MAX_OWNERS) {
    throw new SubscriptionError(
      `The FOUNDING plan is limited to the first ${FOUNDING_MAX_OWNERS} owners and is now full.`,
      "FOUNDING_FULL",
      409,
    );
  }
}

/**
 * Plans an owner may choose — public plans only. FOUNDING is never selectable:
 * it is auto-assigned to the first 10 owners at subscription creation
 * (`ensureForOwner`), so it must not appear here for anyone. `ownerId` is kept
 * for signature stability with the route.
 */
async function listPlansForOwner(_ownerId: string) {
  const plans = await prisma.subscription_plans.findMany({
    where: { is_active: true },
    orderBy: { price_paise: "asc" },
  });

  return plans
    .filter((p: any) => p.is_public && p.code !== FOUNDING_PLAN_CODE)
    .map((p: any) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      price_paise: p.price_paise,
      currency: p.currency,
      billing_cycle: p.billing_cycle,
      capacity_min: p.capacity_min,
      capacity_max: p.capacity_max, // null = unlimited (FOUNDING / a custom Portfolio)
      // Business rules (2026-09-10): included vs. paid-extra beds.
      // `max_extra_beds: null` = no ceiling (FOUNDING only, never public so
      // never actually seen here); `0` = extra beds not offered (Portfolio).
      included_beds: p.included_beds,
      max_extra_beds: p.max_extra_beds,
      extra_bed_price_paise: p.extra_bed_price_paise,
      is_public: p.is_public,
    }));
}

function makeInvoiceNumber(): string {
  return `SUB-${new Date().getUTCFullYear()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

export const subscriptionService = {
  ensureForOwner,
  getForOwner,
  listPlansForOwner,
  foundingSlotStatus,
  canOwnerTakeFounding,
  foundingPartnerNumber,
  reserveFoundingSlotInTx,
  requirePlanByCode,
  makeInvoiceNumber,
  CURRENCY,
  FOUNDING_LOCK_KEY,
};
