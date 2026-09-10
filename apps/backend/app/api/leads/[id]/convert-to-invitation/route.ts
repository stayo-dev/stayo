export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiError } from "@/lib/auth";
import { admissionsService } from "@/src/services/admissions/admissions-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return ApiResponse.error(ApiError.forbidden("Only owners can convert leads"));
  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    return ApiResponse.success(await admissionsService.convertToInvitation(params.id, scope.owner_id, body), "Invitation created", { status: 201 });
  } catch (error: any) {
    // Same structured refusal the plain invite route serialises. `ApiResponse.error`
    // knows nothing about tenancy eligibility, so without this a lead converted for
    // an ineligible phone number came back as a 500 with the disclosure scope
    // thrown away — and the wizard, which renders the identical conflict card on
    // both paths, had nothing to render.
    if (error?.name === "TenancyEligibilityError") {
      // `apiError`, not `ApiResponse.error`: the latter nests extras under
      // `error.metadata`, and the wizard's `parseTenancyConflict` reads
      // `error.details` — the exact key the plain invite route already emits.
      return apiError(error.message, error.code, error.status ?? 409, error.disclosure);
    }
    return ApiResponse.error(error);
  }
}
