export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";

/**
 * GET /api/hostels/[id]/house-rules
 * PATCH /api/hostels/[id]/house-rules — body: { sections: [{ title, items: string[] }] }
 * A dedicated, self-contained endpoint rather than folding into the
 * deep-merged hostel preferences policy blob — house rules are simple
 * static content, not a policy setting.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }
  const { id } = await params;

  try {
    const scope = resolveOwnerScope(session);
    const hostel = await prisma.hostels.findFirst({ where: { id, owner_id: scope.owner_id }, select: { house_rules: true } });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);
    return apiResponse({ sections: hostel.house_rules ?? [] });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch house rules");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }
  const { id } = await params;

  try {
    const scope = resolveOwnerScope(session);
    const existing = await prisma.hostels.findFirst({ where: { id, owner_id: scope.owner_id }, select: { id: true } });
    if (!existing) return apiError("Hostel not found", "NOT_FOUND", 404);

    const body = await req.json().catch(() => ({}));
    const sections = Array.isArray(body?.sections) ? body.sections : [];

    const updated = await prisma.hostels.update({
      where: { id },
      data: { house_rules: sections },
      select: { house_rules: true },
    });
    return apiResponse({ sections: updated.house_rules ?? [] });
  } catch (error: any) {
    return apiError(error?.message || "Failed to update house rules");
  }
}
