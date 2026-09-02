export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { eventLog } from "@/lib/services/event-log-service";
import { backendUrl } from "@/lib/config/domains";
import crypto from "crypto";
import { requiredKycDocTypes, recomputeDocumentVerified } from "@/src/services/tenants/kyc-status";

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
      return NextResponse.json({ error: { message: "Archived documents cannot be verified" } }, { status: 409 });
    }
    if (!requiredKycDocTypes(doc.tenant.profile_type).includes(doc.doc_type)) {
      return NextResponse.json({ error: { message: "This document type is not required for this tenant" } }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Conditional write: only a still-PENDING active row transitions. A
      // concurrent Approve/Reject from another tab loses this race and gets a
      // 409 rather than silently flipping an already-decided document.
      const applied = await tx.identificationDocument.updateMany({
        where: { id: docId, is_active: true, document_status: "PENDING" },
        data: {
          document_status: "APPROVED",
          is_verified: true,
          approved_by: session.sub,
          approved_at: new Date(),
        },
      });
      if (applied.count === 0) return { conflict: true as const };

      await tx.notifications.create({
        data: {
          id: crypto.randomUUID(),
          profile_id: doc.tenant.profile_id,
          title: "Document Approved",
          message: `Your uploaded ${doc.doc_type} has been verified and approved by the owner.`,
          type: "INFO",
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

    await eventLog.log("document_verified", doc.tenant.owner_id || null, {
      tenant_id: tenantId,
      document_id: docId,
      doc_type: doc.doc_type,
      approved_by: session.sub,
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
    console.error("Verify document error:", error);
    return NextResponse.json({ error: { message: "Internal server error" } }, { status: 500 });
  }
}
