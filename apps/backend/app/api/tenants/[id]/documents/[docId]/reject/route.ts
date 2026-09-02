export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { eventLog } from "@/lib/services/event-log-service";
import { backendUrl } from "@/lib/config/domains";
import crypto from "crypto";
import { recomputeDocumentVerified } from "@/src/services/tenants/kyc-status";
import { appendMessage } from "@/src/services/tenants/document-thread";

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

    const ownerProfile = await prisma.profile.findUnique({
      where: { id: session.sub },
      select: { name: true },
    });
    const ownerName = ownerProfile?.name || "Owner";
    const thread = appendMessage(doc.rejection_reason, {
      sender: "owner",
      sender_name: ownerName,
      message: reason,
    });

    const result = await prisma.$transaction(async (tx) => {
      // Only a still-PENDING active row can be rejected. A concurrent decision
      // from another tab loses the race and gets a 409.
      const applied = await tx.identificationDocument.updateMany({
        where: { id: docId, is_active: true, document_status: "PENDING" },
        data: {
          document_status: "REJECTED",
          is_verified: false,
          rejection_reason: thread,
          rejected_by: session.sub,
          rejected_at: new Date(),
        },
      });
      if (applied.count === 0) return { conflict: true as const };

      await tx.notifications.create({
        data: {
          id: crypto.randomUUID(),
          profile_id: doc.tenant.profile_id,
          title: "Document Rejected",
          message: `Your uploaded ${doc.doc_type} was rejected: "${reason}". Please review and upload a valid copy.`,
          type: "WARNING",
        },
      });

      const documentVerified = await recomputeDocumentVerified(tx, tenantId);
      const updatedDoc = await tx.identificationDocument.findUnique({ where: { id: docId } });
      return { conflict: false as const, updatedDoc, documentVerified };
    });

    if (result.conflict) {
      return NextResponse.json(
        { error: { message: "This document has already been reviewed. Refresh to see its current status." } },
        { status: 409 },
      );
    }

    await eventLog.log("document_rejected", doc.tenant.owner_id || null, {
      tenant_id: tenantId,
      document_id: docId,
      doc_type: doc.doc_type,
      rejected_by: session.sub,
    }, tenantId);

    const { file_url, file_path, file_id, ...safeDoc } = result.updatedDoc as any;
    return NextResponse.json({
      success: true,
      data: {
        ...safeDoc,
        document_verified: result.documentVerified,
        download_url: backendUrl(`/api/tenants/${tenantId}/documents/${docId}/download`),
      },
    });
  } catch (error) {
    console.error("Reject document error:", error);
    return NextResponse.json({ error: { message: "Internal server error" } }, { status: 500 });
  }
}
