export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Every agreement template for a hostel, with the number of agreements issued
 * from each.
 *
 * The existing singular `/agreement-template` endpoint resolves one active
 * RESIDENCY template plus its draft — it cannot answer "which templates exist
 * and how many tenants are on each", which is the whole Templates screen. This
 * adds that without touching the endpoint the activation flow depends on.
 *
 * `rules_content` is deliberately **excluded** here: it is the full clause body
 * of every template, and a list screen only needs counts. The detail screen
 * fetches one template's content through the singular endpoint.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    // Ownership check on the hostel, not just the session role — an owner must
    // not be able to read another owner's templates by guessing a hostel id.
    const hostel = await prisma.hostels.findFirst({
      where: { id: params.id, owner_id: session.sub },
      select: { id: true },
    });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    const templates = await prisma.agreementTemplate.findMany({
      where: { hostel_id: params.id },
      orderBy: [{ status: "asc" }, { updated_at: "desc" }, { created_at: "desc" }],
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        version: true,
        version_number: true,
        is_active: true,
        published_at: true,
        created_at: true,
        updated_at: true,
        _count: { select: { agreements: true } },
      },
    });

    return apiResponse({
      templates: (templates as any[]).map((template) => ({
        id: template.id,
        title: template.title,
        type: template.type,
        status: template.status,
        version: template.version,
        version_number: template.version_number,
        is_active: template.is_active,
        published_at: template.published_at,
        updated_at: template.updated_at ?? template.created_at,
        /** Agreements issued from this template — the "182 tenants" figure. */
        agreements_count: template._count?.agreements ?? 0,
      })),
    });
  } catch (error: any) {
    console.error("[owner.agreement-templates] failed", { error: error?.message });
    return apiError("Could not load agreement templates", "AGREEMENT_TEMPLATES_ERROR", 500);
  }
}
