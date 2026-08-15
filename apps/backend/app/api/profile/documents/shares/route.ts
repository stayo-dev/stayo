export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { documentVaultService } from "@/src/services/profile/document-vault-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

const ShareSchema = z.object({ hostel_id: z.string().uuid() });

/**
 * The tenant's own control over who can see their documents.
 *
 * POST grants a hostel access to every active document; DELETE ends it. Both
 * are the *person's* call — an owner cannot grant themselves access, which is
 * the property that makes the vault safe to share across hostels at all.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) throw ApiError.unauthorized("Sign in to continue");

    const parsed = ShareSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw ApiError.validationError("A hostel id is required");

    const result = await documentVaultService.grantToHostel(session.sub, parsed.data.hostel_id);
    return ApiResponse.success(result, "Documents shared with this hostel");
  } catch (error) {
    return ApiResponse.error(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) throw ApiError.unauthorized("Sign in to continue");

    const hostelId = req.nextUrl.searchParams.get("hostel_id");
    if (!hostelId) throw ApiError.validationError("A hostel id is required");

    const result = await documentVaultService.revokeFromHostel(session.sub, hostelId);
    return ApiResponse.success(result, "Access removed");
  } catch (error) {
    return ApiResponse.error(error);
  }
}
