export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  NavigationSchema,
  navigationGaps,
  parseNavigation,
  readNavigationSafely,
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
      select: { id: true, name: true },
    });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    // Read tolerantly, like the public listing does: this screen must still open
    // on a database where migration 074 has not run, so the admin can be told
    // that rather than shown a Prisma stack trace.
    const raw = await readNavigationSafely(async () => {
      const rows = await prisma.$queryRaw<{ navigation: unknown }[]>`
        SELECT navigation FROM hostels WHERE id = ${id}::uuid LIMIT 1
      `;
      return rows[0]?.navigation ?? null;
    });

    return apiResponse({
      hostel_id: hostel.id,
      navigation: raw,
      gaps: navigationGaps(raw),
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

    // Raw SQL, not `prisma.hostels.update`: `navigation` is deliberately not on
    // the Prisma model (see schema.prisma and migration 074), because declaring
    // it makes every `include:`-only read of `hostels` demand the column.
    if (raw === null) {
      await prisma.$executeRaw`UPDATE hostels SET navigation = NULL WHERE id = ${id}::uuid`;
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

    await prisma.$executeRaw`
      UPDATE hostels SET navigation = ${JSON.stringify(parsed.data)}::jsonb WHERE id = ${id}::uuid
    `;

    return apiResponse({
      hostel_id: id,
      navigation: parsed.data,
      gaps: navigationGaps(parsed.data),
    });
  } catch (error: any) {
    // The one failure worth naming: saving cannot degrade the way reading can,
    // so say what is actually wrong rather than surfacing "column does not
    // exist" to whoever is trying to locate a hostel.
    const message = String(error?.message || "");
    if (message.includes("navigation") && /does not exist|undefined column/i.test(message)) {
      return apiError(
        "Navigation storage is not set up on this database yet — migration 074 has not been applied.",
        "MIGRATION_REQUIRED",
        503,
      );
    }
    return apiError(message || "Failed to save navigation");
  }
}
