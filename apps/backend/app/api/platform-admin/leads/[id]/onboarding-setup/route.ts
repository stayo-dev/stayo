export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { requireAdminOrManagerPermission } from "@/src/services/managers/manager-authorization";
import { prisma } from "@/lib/db";
import { OnboardingSetupSchema } from "@/lib/validators";
import { FOUNDING_PLAN_CODE, FOUNDING_MAX_OWNERS } from "@/src/services/platform-billing/subscription-rules";

/**
 * PATCH /api/platform-admin/leads/[id]/onboarding-setup
 * Body: { plan_code }
 *
 * Admin -> Add Owner, plan step. Stores the admin's plan choice on the lead
 * itself — a real `owner_subscriptions` row cannot exist yet (it requires an
 * owner_id, and no owner account exists until the invitation link is used).
 * The choice is applied for real by
 * LeadInvitationService.activateInvitationForOwner via the existing
 * subscriptionService.ensureForOwner / subscriptionAdminService.changePlan,
 * once the owner completes signup. Only valid for DIRECT_ADMIN leads that
 * haven't been invited yet — website leads never set this.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    await requireAdminOrManagerPermission(session, "MANAGE_ONBOARDING");

    const lead = await prisma.platform_leads.findUnique({ where: { id } });
    if (!lead) return apiError("Lead not found", "NOT_FOUND", 404);
    if (lead.acquisition_source !== "DIRECT_ADMIN") {
      return apiError("Plan pre-selection only applies to Admin-added owners.", "NOT_DIRECT_ADMIN_LEAD", 400);
    }
    if (["INVITE_SENT", "OWNER_ACTIVATED", "HOSTEL_CREATED", "LIVE"].includes(lead.status)) {
      return apiError("The onboarding link has already been sent for this owner.", "ALREADY_INVITED", 409);
    }

    const body = await req.json().catch(() => ({}));
    const validated = OnboardingSetupSchema.safeParse(body);
    if (!validated.success) return apiError("Validation error", "VALIDATION_ERROR", 400);
    const { plan_code } = validated.data;

    const plan = await prisma.subscription_plans.findFirst({ where: { code: plan_code, is_active: true } });
    if (!plan) return apiError(`Plan "${plan_code}" is not available.`, "PLAN_NOT_FOUND", 404);

    // Read-only preview so the admin sees an accurate "slots left" — the
    // actual atomic reservation happens later, inside
    // subscriptionAdminService.changePlan (reserveFoundingSlotInTx), when
    // the owner completes signup. This never reserves a slot itself.
    let founding_slots_remaining: number | null = null;
    if (plan.code === FOUNDING_PLAN_CODE) {
      const used = await prisma.owner_subscriptions.count({
        where: { OR: [{ plan_id: plan.id }, { pending_plan_id: plan.id }] },
      });
      founding_slots_remaining = Math.max(0, FOUNDING_MAX_OWNERS - used);
    }

    const updated = await prisma.platform_leads.update({
      where: { id },
      data: {
        intended_plan_code: plan.code,
        intended_plan_set_by: session?.sub ?? null,
        updated_at: new Date(),
      },
    });

    return apiResponse({
      id: updated.id,
      intended_plan_code: updated.intended_plan_code,
      founding_slots_remaining,
    });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to set onboarding plan");
    if (error?.name === "HttpForbidden") return apiError(error.message, "FORBIDDEN", 403);
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
