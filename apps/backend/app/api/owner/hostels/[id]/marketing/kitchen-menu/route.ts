export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { marketingPageService } from "@/src/services/marketing/marketing-page-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

/**
 * The hostel's live kitchen menu, for the listing's mess editor to copy in.
 *
 * Read-only. Nothing here writes the listing: the owner imports, edits, and
 * submits through the same review cycle as any other change, because a
 * published listing is reviewed content and a food schedule is not
 * (ADR-077).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(req);
    if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
      throw ApiError.forbidden("Owner access required");
    }
    // An admin is unscoped here for the same reason as the editor itself —
    // Stayo's team writes listings on an owner's behalf. See marketing-scope.
    const actor = { id: session.sub, isAdmin: session.role === "ADMIN" };
    const menu = await marketingPageService.getKitchenMenu(actor, params.id);
    return ApiResponse.success(menu);
  } catch (error) {
    return ApiResponse.error(error);
  }
}
