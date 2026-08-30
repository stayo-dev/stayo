export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildInviteSettlementPreview } from "@/lib/billing/invite-settlement-preview";

/**
 * 📍 POST /api/tenants/invite-settlement-preview
 *
 * "The tenant has already paid ₹40,000 — where does it go?", answered before
 * anything is created.
 *
 * Two situations need this. A deposit negotiated face-to-face and handed over
 * in cash at the door; and onboarding a hostel that has been running for
 * months, whose tenants are five rent cycles in and have paid for them. In both
 * the owner is recording history, and should see how it lands before committing
 * to it.
 *
 * Pure and read-only: `buildInviteSettlementPreview` synthesises the
 * obligations that *would* exist from the terms on the form and runs the same
 * settlement planner the real allocation uses, so the preview and the outcome
 * cannot disagree. Nothing is written, and no tenancy need exist yet.
 *
 * Access: Owner/Admin. `due_day` comes from the hostel's own preferences rather
 * than the caller, so a preview cannot be skewed by a forged due date.
 */
const PreviewSchema = z.object({
  hostel_id: z.string().uuid(),
  monthly_rent: z.coerce.number().min(0),
  security_deposit: z.coerce.number().min(0).default(0),
  maintenance_charge: z.coerce.number().min(0).default(0),
  maintenance_type: z.string().default("MONTHLY"),
  agreement_start_date: z.string().min(1),
  agreement_duration_months: z.coerce.number().int().positive().max(120),
  amount_paid: z.coerce.number().min(0),
  amount_includes_deposit: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const body = await req.json().catch(() => ({}));
  const parsed = PreviewSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Validation failed", "VALIDATION_ERROR", 400);
  }
  const data = parsed.data;

  const startDate = new Date(data.agreement_start_date);
  if (Number.isNaN(startDate.getTime())) {
    return apiError("Invalid agreement start date", "VALIDATION_ERROR", 400);
  }

  try {
    const hostel = await prisma.hostels.findFirst({
      where: { id: data.hostel_id, owner_id: session.sub },
      select: { preferences_config: true },
    });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    const prefs = (hostel.preferences_config as any) || {};
    const dueDay = Number(prefs.due_day) >= 1 && Number(prefs.due_day) <= 28 ? Number(prefs.due_day) : 5;

    const preview = buildInviteSettlementPreview({
      monthlyRent: data.monthly_rent,
      securityDeposit: data.security_deposit,
      maintenanceCharge: data.maintenance_charge,
      maintenanceType: data.maintenance_type,
      agreementStartDate: startDate,
      durationMonths: data.agreement_duration_months,
      dueDay,
      amountPaid: data.amount_paid,
      amountIncludesDeposit: data.amount_includes_deposit,
      today: new Date(),
    });

    return apiResponse({ preview });
  } catch (error: any) {
    console.error("Detailed API Error [tenants.invite-settlement-preview.POST]:", error);
    return apiError(error?.message || "Failed to preview settlement", "PREVIEW_ERROR", 500);
  }
}
