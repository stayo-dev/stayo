export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { eventLog } from "@/lib/services/event-log-service";
import { backendUrl } from "@/lib/config/domains";
import crypto from "crypto";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  try {
    const session = await getSession(req);
    if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
      return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
    }

    const { id: tenantId, docId } = params;
    const body = await req.json().catch(() => ({}));
    const reason = String(body.reason || "").trim();
    if (!reason) {
      return NextResponse.json({ error: { message: "Reason is required" } }, { status: 400 });
    }
    if (reason.length > 800) {
      return NextResponse.json({ error: { message: "Reason must be under 800 characters" } }, { status: 400 });
    }

    const doc = await prisma.identificationDocument.findUnique({
      where: { id: docId },
      include: { tenant: true },
    });

    if (!doc || doc.tenant_id !== tenantId) {
      return NextResponse.json({ error: { message: "Document not found" } }, { status: 404 });
    }
    if (session.role === "OWNER" && doc.tenant.owner_id !== session.sub) {
      return NextResponse.json({ error: { message: "Forbidden" } }, { status: 403 });
    }
    if (!doc.is_active) {
      return NextResponse.json({ error: { message: "Archived documents cannot be rejected" } }, { status: 409 });
    }

    // Get owner's name
    const ownerProfile = await prisma.profile.findUnique({
      where: { id: session.sub },
      select: { name: true },
    });
    const ownerName = ownerProfile?.name || "Owner";

    // Initialize/append message thread in rejection_reason
    let messages = [];
    try {
      if (doc.rejection_reason && doc.rejection_reason.startsWith("[") && doc.rejection_reason.endsWith("]")) {
        messages = JSON.parse(doc.rejection_reason);
      } else if (doc.rejection_reason) {
        messages = [{ sender: "owner", sender_name: ownerName, message: doc.rejection_reason, timestamp: doc.updated_at || doc.created_at }];
      }
    } catch {
      messages = [];
    }

    messages.push({
      sender: "owner",
      sender_name: ownerName,
      message: reason,
      timestamp: new Date().toISOString(),
    });

    const updatedDoc = await prisma.identificationDocument.update({
      where: { id: docId },
      data: {
        document_status: "REJECTED",
        is_verified: false,
        rejection_reason: JSON.stringify(messages),
        rejected_by: session.sub,
        rejected_at: new Date(),
      },
    });

    // Notify the tenant
    await prisma.notifications.create({
      data: {
        id: crypto.randomUUID(),
        profile_id: doc.tenant.profile_id,
        title: "Document Rejected",
        message: `Your uploaded ${doc.doc_type} was rejected: "${reason}". Please review and upload a valid copy.`,
        type: "WARNING",
      },
    });

    // Set tenant's document_verified flag to false
    await prisma.tenants.update({
      where: { id: tenantId },
      data: { document_verified: false },
    });

    await eventLog.log("document_rejected", doc.tenant.owner_id || null, {
      tenant_id: tenantId,
      document_id: docId,
      doc_type: doc.doc_type,
      rejected_by: session.sub,
    }, tenantId);

    const { file_url, file_path, file_id, ...safeDoc } = updatedDoc;
    return NextResponse.json({
      success: true,
      data: {
        ...safeDoc,
        download_url: backendUrl(`/api/tenants/${tenantId}/documents/${docId}/download`),
      },
    });
  } catch (error) {
    console.error("Reject document error:", error);
    return NextResponse.json({ error: { message: "Internal server error" } }, { status: 500 });
  }
}
