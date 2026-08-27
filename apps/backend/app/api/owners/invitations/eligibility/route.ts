export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { tenancyEligibilityService } from "@/src/services/tenants/tenancy-eligibility-service";
import { normalizeIndianPhone } from "@/lib/utils/phone-utils";

/**
 * 🔎 Pre-submit tenancy-eligibility check
 * Access: Owner only
 *
 * `GET /api/owners/invitations/eligibility?phone=&email=`
 *
 * Read-only — reuses the exact same rule and OWN/OTHER disclosure scoping as
 * the 409 refusal `POST /api/owners/invitations` already returns
 * (`tenancyEligibilityService.checkEligibility` via `previewEligibilityByContact`).
 * This is not a new disclosure surface, just the same answer offered earlier,
 * before the owner fills out the rest of the invite form. Never creates or
 * mutates anything, so it is safe to call on every debounced keystroke.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Only owners can check invite eligibility", "FORBIDDEN", 403);
  }

  const { searchParams } = new URL(req.url);
  const rawPhone = searchParams.get("phone");
  const email = searchParams.get("email")?.trim().toLowerCase() || null;
  const phone = rawPhone ? normalizeIndianPhone(rawPhone) : null;
  if (!phone && !email) {
    return apiError("phone or email is required", "VALIDATION_ERROR", 400);
  }

  const result = await tenancyEligibilityService.previewEligibilityByContact(
    { email, phone },
    session.sub
  );

  return apiResponse({
    has_account: result.hasAccount,
    eligible: result.eligibility.eligible,
    code: result.eligibility.eligible ? null : result.eligibility.code,
    disclosure: result.eligibility.eligible ? null : result.eligibility.disclosure,
  });
}
