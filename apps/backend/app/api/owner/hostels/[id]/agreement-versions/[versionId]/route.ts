export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * One past version's wording, fetched when an owner opens or reuses it.
 *
 * Read-only by design. Bringing an old version back is not an operation on
 * this row: the owner loads its `rules_content` into their draft and publishes
 * it as a *new* version through the path that already exists. The archived row
 * is never rewritten, so the tenants who signed it keep pointing at the text
 * and the date they actually agreed to.
 *
 * Scoped by `hostel_id` as well as `id`. The id alone is a bare uuid on a
 * legally significant document; without the hostel clause, knowing one would
 * be enough to read another owner's agreement.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; versionId: string } },
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const hostel = await prisma.hostels.findFirst({
      where: { id: params.id, owner_id: session.sub },
      select: { id: true },
    });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    const version = await prisma.agreementTemplate.findFirst({
      where: {
        id: params.versionId,
        hostel_id: params.id,
        type: "RESIDENCY",
        status: { in: ["PUBLISHED", "ARCHIVED"] },
      },
      select: {
        id: true,
        version_number: true,
        status: true,
        published_at: true,
        created_at: true,
        rules_content: true,
        _count: { select: { agreements: true } },
      },
    });
    if (!version) return apiError("Version not found", "NOT_FOUND", 404);

    return apiResponse({
      version: {
        id: version.id,
        version_number: version.version_number,
        is_live: version.status === "PUBLISHED",
        published_at: version.published_at ?? version.created_at,
        agreements_count: (version as any)._count?.agreements ?? 0,
        rules_content: version.rules_content,
      },
    });
  } catch (error: any) {
    console.error("[owner.agreement-version] failed", { error: error?.message });
    return apiError("Could not load that version", "AGREEMENT_VERSION_ERROR", 500);
  }
}
