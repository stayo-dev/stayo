export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiError, apiResponse } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { invitationService } from "@/src/services/tenants/invitation-service";
import crypto from "crypto";
import { frontendUrl } from "@/lib/config/domains";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json();
    const action = String(body?.action || "").toUpperCase();
    const tenant = await prisma.tenants.findUnique({
      where: { id: params.id },
      include: {
        profiles: true,
        hostels: true,
        tenant_invitations: { orderBy: { created_at: "desc" }, take: 1 },
      },
    });
    if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);
    if (tenant.owner_id !== session.sub) return apiError("Forbidden", "FORBIDDEN", 403);

    if (action === "RESEND_INVITE") {
      if (tenant.status !== "INVITED") {
        return apiError("Invite can only be resent for invited tenants", "VALIDATION_ERROR", 400);
      }
      const inviteEmail = tenant.profiles?.email || tenant.tenant_invitations?.[0]?.email;
      if (!inviteEmail) {
        return apiError("Invitation contact email is missing", "VALIDATION_ERROR", 400);
      }
      const result = await invitationService.resendInvitation(inviteEmail, {
        id: session.sub,
        role: session.role,
      });
      return apiResponse(result);
    }

    if (action === "REGENERATE_INVITE_TOKEN" || action === "EXTEND_INVITATION_EXPIRY") {
      if (tenant.status !== "INVITED") {
        return apiError("Invitation can only be changed for invited tenants", "VALIDATION_ERROR", 400);
      }
      if (!tenant.profile_id || !tenant.profiles) {
        return apiError("Use resend invitation for tenant-first invitations", "VALIDATION_ERROR", 400);
      }

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const token = action === "REGENERATE_INVITE_TOKEN"
        ? crypto.randomBytes(32).toString("hex")
        : tenant.profiles.invitation_token || crypto.randomBytes(32).toString("hex");

      await prisma.profile.update({
        where: { id: tenant.profile_id },
        data: {
          invitation_token: token,
          invitation_expires_at: expiresAt,
        },
      });

      const activationLink = frontendUrl(`/activate/${token}`);
      const notification = await prisma.notifications.create({
        data: {
          profile_id: tenant.profile_id,
          title: "Activation link updated",
          message: `${tenant.hostels?.name || "Your hostel"} has updated your activation link. Please continue your setup.`,
          type: action,
        },
      });

      return apiResponse({
        activation_link: activationLink,
        invitation_expires_at: expiresAt,
        notification,
      });
    }

    if (action === "MARK_DOCUMENTS_VERIFIED") {
      const docs = await prisma.identificationDocument.updateMany({
        where: { tenant_id: tenant.id, is_active: true },
        data: {
          document_status: "APPROVED",
          is_verified: true,
          approved_by: session.sub,
          approved_at: new Date(),
        },
      });

      await prisma.tenants.update({
        where: { id: tenant.id },
        data: { document_verified: docs.count > 0 },
      });

      return apiResponse({ verified_documents: docs.count });
    }

    if (action === "RESEND_RULES" || action === "REMIND_DOCUMENTS") {
      if (!tenant.profile_id) {
        return apiError("Tenant profile is not available until activation starts", "VALIDATION_ERROR", 400);
      }
      const title = action === "RESEND_RULES" ? "Please review hostel rules" : "Documents pending";
      const message =
        action === "RESEND_RULES"
          ? `${tenant.hostels?.name || "Your hostel"} has requested that you review and acknowledge the hostel rules.`
          : `${tenant.hostels?.name || "Your hostel"} needs your identity documents for verification.`;

      const notification = await prisma.notifications.create({
        data: {
          profile_id: tenant.profile_id,
          title,
          message,
          type: action,
        },
      });
      return apiResponse({ notification });
    }

    return apiError("Unsupported compliance action", "VALIDATION_ERROR", 400);
  } catch (error: any) {
    return apiError(error?.message || "Failed to run compliance action");
  }
}
