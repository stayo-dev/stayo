export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { stayService } from "@/src/services/stay/stay-service";
import { recordGuardianConsent, revokeGuardianConsent } from "@/src/services/stay/stay-guardian-consent";
import { stayErrorResponse } from "@/src/services/stay/stay-errors";

const SOURCES = new Set(["QR", "APP"]);

/**
 * POST /api/tenant/stay/guardian-consent
 * Body: { granted: boolean, source: "QR" | "APP" }
 *
 * ADR-233. Separate from the stay event on purpose: a declined consent must be
 * recorded even when the leave that prompted it then fails, or the tenant is
 * asked again next time having already said no.
 *
 * The tenant comes from the session, never the body. Returns { guardian }.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden: Only tenants can access this endpoint", "FORBIDDEN", 403);
  }
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.granted !== "boolean") {
      return apiError("granted must be true or false", "INVALID_REQUEST", 400);
    }
    if (!SOURCES.has(body?.source)) {
      return apiError("source must be QR or APP", "INVALID_REQUEST", 400);
    }

    const me = await stayService.getMyStay(session.sub);
    if (!me.resident || !me.tenantId) {
      return apiError("Only a current resident can set this.", "STAY_INELIGIBLE", 409);
    }

    // Turning it off after it was on is a revocation, which is a different
    // column from a guardian's STOP and must not overwrite one.
    if (!body.granted && me.guardian?.consent === "GRANTED") {
      await revokeGuardianConsent(me.tenantId);
      const after = await stayService.getMyStay(session.sub);
      return apiResponse({ guardian: after.guardian });
    }

    const guardian = await recordGuardianConsent({
      tenantId: me.tenantId,
      granted: body.granted,
      source: body.source,
    });
    if (!guardian) {
      return apiError("There is no guardian on file for this tenancy.", "STAY_INELIGIBLE", 409);
    }
    return apiResponse({ guardian });
  } catch (error) {
    return stayErrorResponse(error);
  }
}
