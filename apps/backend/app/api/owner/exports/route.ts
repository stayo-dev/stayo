export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getSession, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { checkFixedWindowLimit } from "@/lib/redis/rate-limit";
import { generateExport } from "@/src/services/exports/owner-money-export-service";
import { parseExportRequest } from "@/src/services/exports/export-request";

/**
 * GET /api/owner/exports?document=&preset=|from=&to=&hostelId=
 *
 * Returns a finished file. Owner-scoped; a hostel filter is ownership-checked
 * rather than trusted, since a hostel id is the one caller-supplied value here
 * that could otherwise reach another owner's data.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);

    // Generating a year of PDF is real work; the same limit the expenses export uses.
    const limit = await checkFixedWindowLimit({
      scope: "owner:exports",
      identifier: scope.owner_id,
      maxAttempts: 10,
      windowSeconds: 60,
    });
    if (!limit.allowed) return apiError("Too many exports — try again in a minute", "TOO_MANY_REQUESTS", 429);

    const request = await parseExportRequest(req.nextUrl.searchParams, scope.owner_id);
    const { body, filename, contentType } = await generateExport(request);

    return new NextResponse(Buffer.from(body), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    const msg = String(error?.message || "Export failed");
    if (msg.startsWith("VALIDATION")) return apiError(msg.split(": ")[1] ?? msg, "VALIDATION_ERROR", 400);
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("UNAUTHORIZED")) return apiError(msg.split(": ")[1] ?? msg, "UNAUTHORIZED", 401);
    return apiError(msg);
  }
}
