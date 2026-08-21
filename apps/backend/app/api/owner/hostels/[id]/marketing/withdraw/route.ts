export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { marketingPageService } from "@/src/services/marketing/marketing-page-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

/**
 * Pull a submission back out of the review queue.
 *
 * This exists because a submitted revision is deliberately **not** editable:
 * an owner changing it mid-review would mean the admin approves something
 * other than what they actually read.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(req);
    if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
      throw ApiError.forbidden("Owner access required");
    }

    const withdrawn = await marketingPageService.withdraw({ id: session.sub, isAdmin: session.role === "ADMIN" }, params.id);
    return ApiResponse.success(withdrawn, "Withdrawn — you can edit it again");
  } catch (error) {
    return ApiResponse.error(error);
  }
}
