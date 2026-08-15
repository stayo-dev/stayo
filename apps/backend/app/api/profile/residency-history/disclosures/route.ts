export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { residencyHistoryService } from "@/src/services/profile/residency-history-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

const DecisionSchema = z.object({
  hostel_id: z.string().uuid(),
  status: z.enum(["APPROVED", "DECLINED", "REVOKED"]),
});

/**
 * Who can see this person's history, and the tenant's control over it.
 *
 * The decision verbs are the tenant's alone — an owner can only *request*
 * (see `/api/owner/tenant-history/request`), never grant.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) throw ApiError.unauthorized("Sign in to continue");

    const disclosures = await residencyHistoryService.listDisclosures(session.sub);
    return ApiResponse.success(disclosures);
  } catch (error) {
    return ApiResponse.error(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) throw ApiError.unauthorized("Sign in to continue");

    const parsed = DecisionSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw ApiError.validationError("A hostel and a decision are required");

    const disclosures = await residencyHistoryService.setDisclosure(
      session.sub,
      parsed.data.hostel_id,
      parsed.data.status,
    );

    return ApiResponse.success(disclosures, "Updated");
  } catch (error) {
    return ApiResponse.error(error);
  }
}
