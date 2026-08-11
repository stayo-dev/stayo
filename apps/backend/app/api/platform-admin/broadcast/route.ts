export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notificationService } from "@/lib/services/notification-service";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/**
 * POST /api/platform-admin/broadcast
 * Body: { message }
 * Sends an in-app notification to every OWNER profile — reuses the existing
 * notification infra rather than a new delivery mechanism.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const body = await req.json().catch(() => ({}));
    const { message, hostel_id } = body;
    if (!message?.trim()) return apiError("message is required", "VALIDATION_ERROR", 400);

    let owners;
    if (hostel_id) {
      // Find the specific owner of this hostel
      const hostel = await prisma.hostels.findUnique({ where: { id: hostel_id }, select: { owner_id: true } });
      if (!hostel || !hostel.owner_id) return apiError("Hostel or owner not found", "NOT_FOUND", 404);
      owners = [{ id: hostel.owner_id }];
    } else {
      // Broadcast to all owners
      owners = await prisma.profile.findMany({ where: { role: "OWNER", is_active: true }, select: { id: true } });
    }

    const results = await Promise.allSettled(
      owners.map((o: any) => notificationService.createNotification(o.id, "Message from Stayo", message.trim(), "PLATFORM_BROADCAST")),
    );
    const sent = results.filter((r) => r.status === "fulfilled").length;

    return apiResponse({ sent, total: owners.length });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to send broadcast");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
