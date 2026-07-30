export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { agreementLifecycleRecoveryService } from "@/src/services/tenants/agreement-lifecycle-recovery-service";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const hostelId = req.nextUrl.searchParams.get("hostelId") || null;
    const ownerId = session.role === "OWNER"
      ? session.owner_id || session.sub
      : req.nextUrl.searchParams.get("ownerId") || null;

    const completion = await agreementLifecycleRecoveryService.getRecoveryCompletion({ ownerId, hostelId });
    return apiResponse(completion);
  } catch (error: any) {
    return apiError(error.message || "Failed to load agreement lifecycle recovery completion");
  }
}
