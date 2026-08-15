export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { residencyHistoryService } from "@/src/services/profile/residency-history-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

const RequestSchema = z.object({
  hostel_id: z.string().uuid(),
  profile_id: z.string().uuid(),
});

/**
 * Ask a person to share their stay history — the invite-flow path.
 *
 * This is what keeps ADR-053's protection intact while still letting an owner
 * look before inviting: the owner asks, the tenant answers. It grants nothing
 * on its own, and it deliberately **cannot** re-open a `DECLINED` or `REVOKED`
 * answer — otherwise "no" becomes a nag, and a repeated request is itself a
 * signal the tenant never consented to receiving.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
      throw ApiError.forbidden("Owner access required");
    }

    const parsed = RequestSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw ApiError.validationError("A hostel and a person are required");

    const result = await residencyHistoryService.requestAccess(
      session.sub,
      parsed.data.hostel_id,
      parsed.data.profile_id,
    );

    return ApiResponse.success(
      result,
      result.requested ? "We've asked them to share their stay history" : undefined,
    );
  } catch (error) {
    return ApiResponse.error(error);
  }
}
