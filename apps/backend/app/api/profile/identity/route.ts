export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { profileIdentityService, IDENTITY_FIELDS } from "@/src/services/profile/profile-identity-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

/**
 * The person's own portable identity.
 *
 * Deliberately requires only a session, **not a tenancy** — the whole point of
 * phase B is that a tenant fills this in before enquiring anywhere. Demanding
 * a `tenants` row would put it back behind the onboarding it exists to
 * shortcut.
 */
async function requireProfile(req: NextRequest) {
  const session = await getSession(req);
  if (!session) throw ApiError.unauthorized("Sign in to continue");
  return session.sub;
}

export async function GET(req: NextRequest) {
  try {
    const profileId = await requireProfile(req);
    const identity = await profileIdentityService.getIdentity(profileId);
    return ApiResponse.success(identity);
  } catch (error) {
    return ApiResponse.error(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const profileId = await requireProfile(req);
    const body = await req.json().catch(() => ({}));

    // Allowlist rather than pass-through: this body is written straight into a
    // row that every future onboarding reads as truth.
    const patch: Record<string, unknown> = {};
    for (const field of IDENTITY_FIELDS) {
      if (field in body) patch[field] = body[field];
    }

    const identity = await profileIdentityService.update(profileId, patch);
    return ApiResponse.success(identity, "Profile saved");
  } catch (error) {
    return ApiResponse.error(error);
  }
}
