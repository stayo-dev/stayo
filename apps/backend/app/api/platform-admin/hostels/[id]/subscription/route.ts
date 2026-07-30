export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/**
 * POST /api/platform-admin/hostels/[id]/subscription
 * Body: { planId, autopayEnabled? }
 * Assigns/changes the hostel's subscription plan — creates the row (status
 * TRIAL, 14-day trial window) if none exists yet, else updates plan/cycle.
 * Cycle and amount are always taken from the plan itself (each plan has one
 * fixed `billing_cycle` — see `subscription_plans`), not client-supplied,
 * since a plan's price only makes sense at its own cycle.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);

    const hostel = await prisma.hostels.findUnique({ where: { id }, select: { id: true } });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    const body = await req.json().catch(() => ({}));
    const { planId, autopayEnabled } = body;
    if (!planId) return apiError("planId is required", "VALIDATION_ERROR", 400);

    const plan = await prisma.subscription_plans.findUnique({ where: { id: planId } });
    if (!plan || !plan.is_active) return apiError("Plan not found or inactive", "NOT_FOUND", 404);

    const cycle = plan.billing_cycle;
    const amount = plan.price_amount;

    const existing = await prisma.hostel_subscriptions.findUnique({ where: { hostel_id: id } });
    const subscription = existing
      ? await prisma.hostel_subscriptions.update({
          where: { hostel_id: id },
          data: { plan_id: planId, billing_cycle: cycle, amount, autopay_enabled: Boolean(autopayEnabled), updated_at: new Date() },
          include: { subscription_plans: true },
        })
      : await prisma.hostel_subscriptions.create({
          data: {
            hostel_id: id,
            plan_id: planId,
            billing_cycle: cycle,
            amount,
            status: "TRIAL",
            autopay_enabled: Boolean(autopayEnabled),
            trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            next_renewal_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          },
          include: { subscription_plans: true },
        });

    return apiResponse(subscription);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to update subscription");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
