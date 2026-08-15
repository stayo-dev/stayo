export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { profileIdentityService } from "@/src/services/profile/profile-identity-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

/**
 * What the activation form should open with (phase B).
 *
 * This is the payoff of the portable profile: a tenant who filled their
 * details before ever enquiring — or who onboarded to a different hostel last
 * year — sees them already there instead of an empty form.
 *
 * Requires a session but **not** a tenancy. Activation calls this while the
 * tenancy is still `INVITED`, and a seeker may reasonably preview it earlier.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session || session.role !== "TENANT") {
      throw ApiError.forbidden("Tenant access required");
    }

    const [identity, profile] = await Promise.all([
      profileIdentityService.getOnboardingDefaults(session.sub),
      prisma.profile.findUnique({
        where: { id: session.sub },
        select: { name: true, email: true, phone: true, emergency_contact: true },
      }),
    ]);

    return ApiResponse.success({
      // Account-level fields the form also asks for, so the client has one
      // place to read defaults from rather than stitching two responses.
      name: profile?.name ?? null,
      email: profile?.email ?? null,
      phone: profile?.phone ?? null,
      emergency_contact: profile?.emergency_contact ?? null,
      ...identity,
      /**
       * True when there is enough here to be worth showing as "we already know
       * this" rather than silently pre-filling a form the person has never
       * seen. The UI uses it to decide between a confirm step and a blank form.
       */
      has_prefill: identity.has_profile_record || identity.pending_backfill_fields.length > 0,
    });
  } catch (error) {
    return ApiResponse.error(error);
  }
}
