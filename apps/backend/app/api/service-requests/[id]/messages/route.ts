export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";
import { notifyServiceRequestParticipant } from "@/lib/services/service-request-notifications";

const MAX_MESSAGE_LENGTH = 2000;

/**
 * GET /api/service-requests/[id]/messages
 * The ticket's full timeline (status changes + chat messages), owner-scoped.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { id } = await params;

  try {
    const scope = resolveOwnerScope(session);
    const request = await prisma.tenant_service_requests.findFirst({
      where: { id },
      include: {
        hostels: { select: { owner_id: true } },
        tenants: { select: { profiles: { select: { name: true } } } },
        tenant_service_request_events: { orderBy: { created_at: "asc" } },
      },
    });
    if (!request || request.hostels.owner_id !== scope.owner_id) {
      return apiError("Request not found", "NOT_FOUND", 404);
    }

    return apiResponse(request);
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch service request messages");
  }
}

/**
 * POST /api/service-requests/[id]/messages
 * Owner sends a chat message on a ticket — never touches `status`, unlike
 * PATCH /api/service-requests/[id]/status. Body: { message }.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { id } = await params;

  try {
    const scope = resolveOwnerScope(session);
    const existing = await prisma.tenant_service_requests.findFirst({
      where: { id },
      include: {
        hostels: { select: { owner_id: true } },
        tenants: { select: { profile_id: true } },
      },
    });
    if (!existing || existing.hostels.owner_id !== scope.owner_id) {
      return apiError("Request not found", "NOT_FOUND", 404);
    }

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
        actor_role: "OWNER",
      },
    });

    const tenantProfileId = existing.tenants.profile_id;
    if (tenantProfileId) {
      // Fire-and-forget, exactly one notification per sent message.
      notifyServiceRequestParticipant(tenantProfileId, existing, message).catch((err: unknown) =>
        console.error("[service-requests/messages] failed to notify tenant:", err),
      );
    }

    return apiResponse(event, 201);
  } catch (error: any) {
    return apiError(error?.message || "Failed to send message");
  }
}
