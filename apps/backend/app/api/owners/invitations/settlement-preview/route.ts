export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { hostelBillingPreferencesService } from "@/lib/services/hostel-billing-preferences-service";

/** Mirrors `initializeOnboardingFinancials`'s own `dueDay` default. */
const ONBOARDING_BACKFILL_DUE_DAY = 5;
import { resolvePriorTenancyPayment } from "@/lib/billing/prior-tenancy-payment";
import { buildInviteSettlementPreview } from "@/lib/billing/invite-settlement-preview";

/**
 * POST /api/owners/invitations/settlement-preview
 *
 * "This tenant already lives here and has already paid me some of it — what
 * exactly will you record?" Answered before anything is written, and answered
 * by the same code that will do the writing.
 *
 * `buildInviteSettlementPreview` has existed, pure and tested, since the
 * "Settle at Invite" work — with no caller at all. This is that caller. It
 * matters that the number the owner approves comes from here rather than from
 * arithmetic repeated in the wizard: the preview's own header warns that a
 * preview disagreeing with what the system creates is worse than none, and the
 * amount is settled through the real allocator, so priority order and rounding
 * are whatever `buildSettlementPlan` says they are. See ADR-141.
 *
 * Read-only. Nothing here creates a tenant, an obligation or a payment.
 */
const PreviewSchema = z.object({
  room_id: z.string().uuid(),
  joining_date: z.string(),
  monthly_rent: z.number().nonnegative().optional(),
  security_deposit: z.number().nonnegative().optional(),
  maintenance_amount: z.number().nonnegative().optional(),
  maintenance_type: z.enum(["MONTHLY", "ONE_TIME", "NONE"]).optional(),
  agreement_duration_months: z.number().int().positive().max(120).optional(),
  rent_paid_through: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .nullable()
    .optional(),
  deposit_paid: z.boolean().optional(),
  maintenance_paid: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const parsed = PreviewSchema.safeParse(await req.json());
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message || "Invalid request", "VALIDATION_ERROR", 400);
    }
    const body = parsed.data;

    const joiningDate = new Date(body.joining_date);
    if (Number.isNaN(joiningDate.getTime())) {
      return apiError("Invalid joining date", "VALIDATION_ERROR", 400);
    }

    // Ownership is enforced here: `resolveTenantInviteDefaults` throws FORBIDDEN
    // for a room the caller does not own, so the preview cannot be used to read
    // another owner's billing configuration.
    const defaults = await hostelBillingPreferencesService.resolveTenantInviteDefaults(
      body.room_id,
      session.sub,
    );

    /**
     * Deliberately the writer's default, not the hostel's configured due day.
     *
     * `tenantInvitationLifecycleService.createInvitation` calls
     * `initializeOnboardingFinancials` **without** a `dueDay`, so that service
     * falls back to 5 for every backfilled month. Reading the hostel's real
     * setting here would make this preview more "correct" and, in doing so,
     * wrong — it would promise due dates the invite then does not create.
     * Matching the writer is the requirement; the writer ignoring the hostel's
     * configured day is a separate defect, recorded in [[TODO]].
     */
    const dueDay = ONBOARDING_BACKFILL_DUE_DAY;

    const monthlyRent = body.monthly_rent ?? defaults.resolved_values.monthly_rent;
    const securityDeposit = body.security_deposit ?? defaults.resolved_values.security_deposit;
    const maintenanceType = body.maintenance_type ?? defaults.resolved_values.maintenance_type;
    const maintenanceCharge = body.maintenance_amount ?? defaults.resolved_values.maintenance_charge;
    const durationMonths =
      body.agreement_duration_months ?? defaults.resolved_values.agreement_duration_months ?? 11;

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // One conversion from the owner's answers to an amount, shared with the
    // invite write path so the two can never disagree.
    const plan = resolvePriorTenancyPayment({
      joiningDate,
      today,
      monthlyRent,
      securityDeposit,
      maintenanceCharge,
      maintenanceType,
      dueDay,
      rentPaidThrough: body.rent_paid_through ?? null,
      depositPaid: Boolean(body.deposit_paid),
      maintenancePaid: Boolean(body.maintenance_paid),
    });

    const settlement = buildInviteSettlementPreview({
      monthlyRent,
      securityDeposit,
      maintenanceCharge,
      maintenanceType,
      agreementStartDate: joiningDate,
      durationMonths,
      dueDay,
      amountPaid: plan.amountPaid,
      amountIncludesDeposit: plan.amountIncludesDeposit,
      today,
    });

    return apiResponse({
      months: plan.months.map((m) => ({
        key: m.key,
        due_date: m.dueDate.toISOString(),
        amount: m.amount,
        settled: m.settled,
      })),
      amount_paid: plan.amountPaid,
      amount_includes_deposit: plan.amountIncludesDeposit,
      truncated: plan.truncated,
      security_deposit: securityDeposit,
      maintenance_amount: maintenanceType === "NONE" ? 0 : maintenanceCharge,
      settlement,
    });
  } catch (error: any) {
    const message = String(error?.message || "Failed to build settlement preview");
    if (message.startsWith("FORBIDDEN")) return apiError(message, "FORBIDDEN", 403);
    if (message.startsWith("NOT_FOUND")) return apiError(message, "NOT_FOUND", 404);
    return apiError(message, "VALIDATION_ERROR", 400);
  }
}
