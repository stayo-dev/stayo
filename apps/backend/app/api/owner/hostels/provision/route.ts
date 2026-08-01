export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import {
  hostelProvisioningService,
  HostelAlreadyExistsError,
} from "@/lib/services/hostel-provisioning-service";

/**
 * 🏨 POST /api/owner/hostels/provision
 *
 * Creates a hostel together with its floors and rooms in a single database
 * transaction. Replaces the onboarding wizard's old publish sequence
 * (1 + F + F×R separate calls against /api/owner/hostels, /api/floors and
 * /api/rooms), which could commit a partially built hostel and then refuse
 * every retry on the duplicate-name guard.
 *
 * Access: Owner/Admin only. The hostel is always created under the
 * authenticated session's own id — the body cannot name an owner.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const result = await hostelProvisioningService.provision(session.sub, body);
    return apiResponse(result, 201);
  } catch (error: any) {
    // A duplicate is recoverable, not fatal: hand back the hostel that already
    // exists so the client can offer to open it rather than dead-ending the
    // owner on step 11 the way the old flow did.
    if (error instanceof HostelAlreadyExistsError) {
      return apiError(error.message.replace(/^ALREADY_EXISTS:\s*/, ""), "ALREADY_EXISTS", 409, {
        hostel_id: error.hostelId,
      });
    }

    const message = String(error?.message || "Failed to provision hostel");
    if (message.startsWith("VALIDATION:")) {
      return apiError(message.replace(/^VALIDATION:\s*/, ""), "VALIDATION_ERROR", 400);
    }

    console.error("Detailed API Error [owner.hostels.provision.POST]:", error);
    return apiError(message, "PROVISION_ERROR", 500);
  }
}
