export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notifyServiceRequestParticipant } from "@/lib/services/service-request-notifications";
import { resolveTenantName } from "@/lib/tenants/tenant-identity";

const MAX_MESSAGE_LENGTH = 2000;

/**
 * POST /api/tenants/me/service-requests/[id]/messages
 * Tenant sends a chat message on their own ticket — never touches `status`.
 * Body: { message }.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { id } = await params;

  try {
    const tenant = await prisma.tenants.findFirst({
      where: { profile_id: session.sub },
      select: { id: true, display_name: true, phone_1: true, profiles: { select: { name: true, phone: true } } },
    });
    if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);

    const existing = await prisma.tenant_service_requests.findFirst({
      where: { id, tenant_id: tenant.id },
      include: { hostels: { select: { owner_id: true } } },
    });
    if (!existing) return apiError("Request not found", "NOT_FOUND", 404);

    const body = await req.json().catch(() => ({}));
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) return apiError("message is required", "VALIDATION_ERROR", 400);
    if (message.length > MAX_MESSAGE_LENGTH) {
      return apiError(`message must be ${MAX_MESSAGE_LENGTH} characters or fewer`, "VALIDATION_ERROR", 400);
    }

    const event = await prisma.tenant_service_request_events.create({
      data: {
        request_id: id,
        status: null,
        note: message,
        actor_role: "TENANT",
      },
    });

    // hostels.owner_id is the owner's profile_id directly (see announcements
    // route's identical use), so no extra lookup is needed to notify them.
    // Fire-and-forget, exactly one notification per sent message.
    notifyServiceRequestParticipant(
      existing.hostels.owner_id,
      existing,
      `${resolveTenantName(tenant)}: ${message}`,
    ).catch((err: unknown) => console.error("[tenants/me/service-requests/messages] failed to notify owner:", err));

    return apiResponse(event, 201);
  } catch (error: any) {
    return apiError(error?.message || "Failed to send message");
  }
}
