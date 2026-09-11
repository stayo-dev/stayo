export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdmin, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * GET /api/platform-admin/revenue   (ADR-172, Phase 5 — owner-level)
 *
 * Stayo SUBSCRIPTION revenue only — what owners pay Stayo. Computed live from
 * `owner_subscriptions` + `subscription_invoices`. Deliberately NOT tenant-rent
 * (`payments` / `rent_obligations` — a different revenue stream owners collect
 * from their tenants), and NOT GST (Stayo is not GST-registered; the old
 * per-hostel `platform_invoices` GST CSV is untouched and lives at
 * `/revenue/export`).
 *
 * `mrr` / `arr` count only `ACTIVE` subscriptions at their current plan price.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);

    const monthStart = new Date(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);

    const [subs, statusGroups, planGroups, collectedThisMonth, collectedLifetime] = await Promise.all([
      prisma.owner_subscriptions.findMany({
        where: { status: "ACTIVE" },
        include: { subscription_plans: { select: { code: true, price_paise: true } } },
      }),
      prisma.owner_subscriptions.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.owner_subscriptions.groupBy({ by: ["plan_id"], _count: { _all: true } }),
      prisma.subscription_invoices.aggregate({
        where: { issued_at: { gte: monthStart } },
        _sum: { amount_paise: true },
        _count: { _all: true },
      }),
      prisma.subscription_invoices.aggregate({ _sum: { amount_paise: true }, _count: { _all: true } }),
    ]);

    const mrrPaise = subs.reduce((acc: number, s: any) => acc + (s.subscription_plans?.price_paise ?? 0), 0);

    const planIds = planGroups.map((g: any) => g.plan_id);
    const plans = await prisma.subscription_plans.findMany({
      where: { id: { in: planIds } },
      select: { id: true, code: true, name: true, price_paise: true, capacity_max: true },
    });
    const planById = new Map(plans.map((p: any) => [p.id, p]));

    const statusCounts: Record<string, number> = {
      PENDING_PAYMENT: 0,
      ACTIVE: 0,
      PAUSED: 0,
      EXPIRED: 0,
      CANCELLED: 0,
      TRIAL: 0,
    };
    for (const g of statusGroups as any[]) statusCounts[g.status] = g._count._all;

    // Payment-review backlog + approved/rejected counts.
    const [pendingPayments, approvedPayments, rejectedPayments] = await Promise.all([
      prisma.subscription_payments.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }),
      prisma.subscription_payments.count({ where: { status: "APPROVED" } }),
      prisma.subscription_payments.count({ where: { status: "REJECTED" } }),
    ]);

    return apiResponse({
      currency: "INR",
      kpis: {
        mrr_paise: mrrPaise,
        arr_paise: mrrPaise * 12,
        collected_this_month_paise: Number(collectedThisMonth._sum.amount_paise ?? 0),
        lifetime_paise: Number(collectedLifetime._sum.amount_paise ?? 0),
        invoices_this_month: collectedThisMonth._count._all,
        invoices_lifetime: collectedLifetime._count._all,
      },
      subscriptions: {
        active: statusCounts.ACTIVE,
        pending_payment: statusCounts.PENDING_PAYMENT,
        paused: statusCounts.PAUSED,
        expired: statusCounts.EXPIRED,
        cancelled: statusCounts.CANCELLED,
        legacy_trial: statusCounts.TRIAL,
        total: (statusGroups as any[]).reduce((a, g) => a + g._count._all, 0),
      },
      payments: {
        pending_review: pendingPayments,
        approved: approvedPayments,
        rejected: rejectedPayments,
      },
      plan_distribution: planGroups
        .map((g: any) => {
          const p: any = planById.get(g.plan_id);
          return {
            code: p?.code ?? null,
            name: p?.name ?? null,
            price_paise: p?.price_paise ?? null,
            capacity_max: p?.capacity_max ?? null,
            owners: g._count._all,
          };
        })
        .sort((a: any, b: any) => (b.owners as number) - (a.owners as number)),
      note: "Stayo subscription revenue only — tenant rent is a separate stream and is not counted here.",
    });
  } catch (error) {
    return subscriptionErrorResponse(error, "platform-admin.revenue");
  }
}
