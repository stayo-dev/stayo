export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { residencyHistoryService } from "@/src/services/profile/residency-history-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

/** The person's own stay history. Always fully visible to them — it is theirs. */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) throw ApiError.unauthorized("Sign in to continue");

    const history = await residencyHistoryService.getOwnHistory(session.sub);
    return ApiResponse.success(history);
  } catch (error) {
    return ApiResponse.error(error);
  }
}
