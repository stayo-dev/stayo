export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { renewalDecisionService } from "@/src/services/tenants/renewal-decision-service";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const tenant = await prisma.tenants.findFirst({
      where: {
        OR: [
          { profile_id: session.sub },
          ...(session.tenant_id ? [{ id: session.tenant_id }] : []),
        ],
      },
      select: { id: true },
    });

    if (!tenant) {
      return apiError("Tenant not found", "TENANT_NOT_FOUND", 404);
    }

    const decision = await renewalDecisionService.getTenantRenewalDecision(tenant.id);
    return apiResponse(decision);
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch agreement renewal state");
  }
}
