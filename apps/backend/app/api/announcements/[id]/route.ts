export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";

/**
 * DELETE /api/announcements/[id]
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { id } = await params;

  try {
    const scope = resolveOwnerScope(session);
    const existing = await prisma.hostel_announcements.findFirst({ where: { id, owner_id: scope.owner_id } });
    if (!existing) return apiError("Announcement not found", "NOT_FOUND", 404);

    await prisma.hostel_announcements.delete({ where: { id } });
    return apiResponse({ deleted: true });
  } catch (error: any) {
    return apiError(error?.message || "Failed to delete announcement");
  }
}
