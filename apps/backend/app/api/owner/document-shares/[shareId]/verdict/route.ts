export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { documentVaultService } from "@/src/services/profile/document-vault-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

const VerdictSchema = z.object({
  verdict: z.enum(["VERIFIED", "REJECTED"]),
  rejection_reason: z.string().max(500).optional().nullable(),
});

/**
 * An owner's verification decision on one shared document.
 *
 * The verdict is written to the **share**, not the document — so it applies to
 * this hostel only. A tenant carrying the same file to their next hostel
 * carries the file, not this decision.
 */
export async function PATCH(req: NextRequest, { params }: { params: { shareId: string } }) {
  try {
    const session = await getSession(req);
    if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
      throw ApiError.forbidden("Owner access required");
    }

    const parsed = VerdictSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw ApiError.validationError("Verdict must be VERIFIED or REJECTED");

    const result = await documentVaultService.setShareVerdict(
      session.sub,
      params.shareId,
      parsed.data.verdict,
      parsed.data.rejection_reason,
    );

    return ApiResponse.success(result);
  } catch (error) {
    return ApiResponse.error(error);
  }
}
