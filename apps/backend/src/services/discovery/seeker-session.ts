import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ApiError } from "@/src/lib/api-error";

/**
 * The Stayo account behind a Discover request.
 *
 * A seeker is a `profiles` row with `role = TENANT` and — usually — no
 * tenancy at all. That is the account `authService.selfSignUpTenant()` has
 * always created; Discover is simply the first surface to give it something to
 * do. Crucially this must NOT require a `tenants` row: demanding one would
 * exclude every person who has not yet moved in, which is nearly everyone
 * browsing.
 *
 * A tenant who already lives somewhere is also a valid seeker — they are
 * allowed to look for their next place — so the presence of a tenancy is
 * neither required nor disqualifying.
 */
export async function requireSeeker(req: NextRequest) {
  const session = await getSession(req);
  if (!session) throw ApiError.unauthorized("Sign in to continue");
  if (session.role !== "TENANT") {
    // Owners and admins have their own surfaces; sending an enquiry as one
    // would create a lead attributed to a profile the owner inbox treats
    // as staff.
    throw ApiError.forbidden("This is a resident account action");
  }

  const profile = await prisma.profile.findUnique({
    where: { id: session.sub },
    select: { id: true, name: true, email: true, phone: true, is_active: true },
  });
  if (!profile || !profile.is_active) throw ApiError.unauthorized("Sign in to continue");

  return profile;
}

/**
 * The same account, or null when there is no usable session.
 *
 * For endpoints that are public but say more to someone signed in — the
 * reviews list, which serves published reviews to everybody and adds the
 * reader's own pending one on top. Never throws: an expired session on a
 * public page is not an error, it is a visitor.
 */
export async function getSeeker(req: NextRequest) {
  try {
    return await requireSeeker(req);
  } catch {
    return null;
  }
}
