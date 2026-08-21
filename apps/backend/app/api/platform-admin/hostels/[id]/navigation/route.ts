export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  NavigationSchema,
  navigationGaps,
  parseNavigation,
} from "@/src/services/discovery/hostel-navigation";

/**
 * A hostel's navigation data — Google Place ID, landmark, entrance photo and
 * distance from the reference campus.
 *
 * **ADMIN only, on both verbs, by design.** This is the field that decides where
 * a student physically walks, and it is deliberately not reachable from any
 * `/api/owner/*` route: an owner editing their own Place ID could point Stayo's
 * directions at whatever building they liked. Same reasoning as `listing_status`
 * (ADR-040). There is no owner-facing mirror of this endpoint, and the owner's
 * marketing editor is not told the field exists.
 */

async function requireAdmin(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") return null;
  return session;
}

/** GET — what the admin drawer loads. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin(req))) return apiError("Forbidden", "FORBIDDEN", 403);
  const { id } = await params;

  try {
    const hostel = await prisma.hostels.findUnique({
      where: { id },
      select: { id: true, name: true, navigation: true },
    });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    return apiResponse({
      hostel_id: hostel.id,
      navigation: parseNavigation(hostel.navigation),
      gaps: navigationGaps(hostel.navigation),
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to load navigation");
  }
}

/**
 * PUT — save, or clear.
 *
 * A `null` body clears the column outright, which is the honest way to undo a
 * wrong Place ID: the listing then shows no directions block at all rather than
 * a button that opens the wrong building.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin(req))) return apiError("Forbidden", "FORBIDDEN", 403);
  const { id } = await params;

  try {
    const existing = await prisma.hostels.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return apiError("Hostel not found", "NOT_FOUND", 404);

    const body = await req.json().catch(() => undefined);
    const raw = body?.navigation;

    if (raw === null) {
      await prisma.hostels.update({ where: { id }, data: { navigation: Prisma.DbNull } });
      return apiResponse({ hostel_id: id, navigation: null, gaps: navigationGaps(null) });
    }

    const parsed = NavigationSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError(
        parsed.error.issues[0]?.message || "Navigation details are not valid",
        "VALIDATION_ERROR",
        422,
      );
    }

    const updated = await prisma.hostels.update({
      where: { id },
      data: { navigation: parsed.data },
      select: { navigation: true },
    });

    return apiResponse({
      hostel_id: id,
      navigation: parseNavigation(updated.navigation),
      gaps: navigationGaps(updated.navigation),
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to save navigation");
  }
}
