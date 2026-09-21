export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { checkFixedWindowLimit } from "@/lib/redis/rate-limit";
import { previewExport } from "@/src/services/exports/owner-money-export-service";
import { parseExportRequest } from "@/src/services/exports/export-request";

/**
 * GET /api/owner/exports/preview — what would be in that file.
 *
 * Exists so the export sheet can say "1,247 payments · ₹14,80,000" BEFORE
 * anything is generated. An owner sending a year's collections to his
 * accountant should be able to tell it is the right thing without opening it,
 * and finding out afterwards costs him a second phone call.
 *
 * Rate-limited more loosely than the file route: this re-fires as the owner
 * types in the Expenses search box (debounced client-side), so 10/minute would
 * lock him out of his own preview. It still runs a real count and sum, so it is
 * not left uncapped as it was before.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);

    const limit = await checkFixedWindowLimit({
      scope: "owner:exports:preview",
      identifier: scope.owner_id,
      maxAttempts: 60,
      windowSeconds: 60,
    });
    if (!limit.allowed) return apiError("Too many requests — try again in a minute", "TOO_MANY_REQUESTS", 429);

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
