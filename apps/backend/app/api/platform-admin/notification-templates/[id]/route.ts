export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/** PATCH /api/platform-admin/notification-templates/[id] — body: { isActive?, body? } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const existing = await prisma.notification_templates.findUnique({ where: { id } });
    if (!existing) return apiError("Template not found", "NOT_FOUND", 404);

    const body = await req.json().catch(() => ({}));
    const { isActive, body: text } = body;

    const updated = await prisma.notification_templates.update({
      where: { id },
      data: {
        ...(isActive !== undefined ? { is_active: Boolean(isActive) } : {}),
        ...(text !== undefined ? { body: text } : {}),
        updated_at: new Date(),
      },
    });
    return apiResponse(updated);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to update template");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
