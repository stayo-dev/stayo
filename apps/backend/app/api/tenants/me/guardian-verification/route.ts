export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  readGuardianVerificationPolicy,
  resolveGuardianVerification,
  shouldShowGuardianWall,
} from "@/src/services/tenants/guardian-verification";
import { isGuardianPhoneVerifiedForTenant } from "@/src/services/tenants/guardian-verification-store";

/**
 * Where an activated tenant stands on guardian verification (ADR-212), and
 * whether the dashboard should say anything about it right now.
 *
 * The equivalent for a tenant *mid-onboarding* is already inside
 * `GET /api/tenants/activate/status` — this is the same answer for someone who
 * has finished onboarding and is inside the app, where the activation token no
 * longer exists.
 *
 * Every judgement here comes from the one pure module both sides share, so the
 * card, the wall and the validation cannot disagree about what is due.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const tenant = await prisma.tenants.findFirst({
      where: {
        OR: [{ profile_id: session.sub }, ...(session.tenant_id ? [{ id: session.tenant_id }] : [])],
      },
      // Explicit, like every other `tenants` read here: a select-less read asks
      // for every declared column, which is how a schema addition has taken
      // production down before.
      select: {
        id: true,
        hostel_id: true,
        phone_2: true,
        guardian_name: true,
        guardian_phone: true,
        profile_type: true,
        guardian_verification_deferred_at: true,
        guardian_verification_prompt_count: true,
        hostels: { select: { preferences_config: true } },
      },
    });
    if (!tenant) return apiError("Tenant not found", "TENANT_NOT_FOUND", 404);

    const guardianPhone = tenant.guardian_phone || tenant.phone_2 || null;
    const status = resolveGuardianVerification({
      policy: readGuardianVerificationPolicy(tenant.hostels?.preferences_config),
      hasGuardianPhone: Boolean(guardianPhone),
      verified: await isGuardianPhoneVerifiedForTenant(tenant.id, guardianPhone),
      guardianRequired: String(tenant.profile_type || "STUDENT").toUpperCase() === "STUDENT",
      deferredAt: tenant.guardian_verification_deferred_at,
      now: new Date(),
    });

    return apiResponse({
      state: status.state,
      deadline_at: status.deadlineAt,
      chased: status.chased,
      guardian_name: tenant.guardian_name,
      // The last four digits only. The number is already on the tenant's own
      // record, but a status endpoint has no reason to restate it in full.
      guardian_phone_hint: guardianPhone ? String(guardianPhone).slice(-4) : null,
      show_wall: shouldShowGuardianWall(status, tenant.guardian_verification_prompt_count ?? 0),
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to read guardian verification status", "ERROR", 500);
  }
}
