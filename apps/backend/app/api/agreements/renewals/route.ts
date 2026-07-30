export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { renewalDecisionService } from "@/src/services/tenants/renewal-decision-service";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const hostelId = req.nextUrl.searchParams.get("hostelId") || undefined;
    const filter = (req.nextUrl.searchParams.get("filter") || "all") as any;
    const ownerId = session.role === "OWNER" ? (session.owner_id || session.sub) : (req.nextUrl.searchParams.get("ownerId") || session.sub);
    const queue = await renewalDecisionService.getOwnerRenewalQueue(ownerId, { hostelId, filter });
    return apiResponse(queue);
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch renewal queue");
  }
}
