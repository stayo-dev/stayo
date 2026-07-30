export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { renewalDecisionService } from "@/src/services/tenants/renewal-decision-service";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return apiError("Unauthorized", "UNAUTHORIZED", 401);
  }

  try {
    const tenantId = req.nextUrl.searchParams.get("tenantId");

    if (session.role === "TENANT") {
      const history = await renewalDecisionService.getAgreementHistory({
        requesterTenantProfileId: session.sub,
      });
      return apiResponse({ agreements: history });
    }

    if (session.role === "OWNER") {
      const history = await renewalDecisionService.getAgreementHistory({
        tenantId,
        ownerId: session.sub,
      });
      return apiResponse({ agreements: history });
    }

    return apiError("Forbidden", "FORBIDDEN", 403);
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch agreement history");
  }
}
