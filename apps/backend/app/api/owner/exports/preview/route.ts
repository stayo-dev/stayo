export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { previewExport } from "@/src/services/exports/owner-money-export-service";
import { parseExportRequest } from "@/src/services/exports/export-request";

/**
 * GET /api/owner/exports/preview — what would be in that file.
 *
 * Exists so the export sheet can say "1,247 payments · Rs. 14,80,000" BEFORE
 * anything is generated. An owner sending a year's rent register to his
 * accountant should be able to tell it is the right thing without opening it,
 * and finding out afterwards costs him a second phone call.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);
    const request = await parseExportRequest(req.nextUrl.searchParams, scope.owner_id);
    const preview = await previewExport(request);
    return apiResponse({ ...preview, period: request.period });
  } catch (error: any) {
    const msg = String(error?.message || "Could not read that period");
    if (msg.startsWith("VALIDATION")) return apiError(msg.split(": ")[1] ?? msg, "VALIDATION_ERROR", 400);
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("UNAUTHORIZED")) return apiError(msg.split(": ")[1] ?? msg, "UNAUTHORIZED", 401);
    return apiError(msg);
  }
}
