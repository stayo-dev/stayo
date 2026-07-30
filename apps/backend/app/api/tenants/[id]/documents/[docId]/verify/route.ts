export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { eventLog } from "@/lib/services/event-log-service";
import { backendUrl } from "@/lib/config/domains";
import crypto from "crypto";

const requiredDocumentTypes = (profileType?: string | null) =>
  String(profileType || "STUDENT").toUpperCase() === "WORKING_PROFESSIONAL"
    ? ["AADHAAR", "WORK_ID"]
    : ["AADHAAR", "COLLEGE_ID"];

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
    if (!requiredDocumentTypes(doc.tenant.profile_type).includes(doc.doc_type)) {
      return NextResponse.json({ error: { message: "This document type is not required for this tenant" } }, { status: 400 });
    }

    const updatedDoc = await prisma.identificationDocument.update({
      where: { id: docId },
      data: {
        document_status: "APPROVED",
        is_verified: true,
        approved_by: session.sub,
        approved_at: new Date(),
      },
    });

    // Notify the tenant
    await prisma.notifications.create({
      data: {
        id: crypto.randomUUID(),
        profile_id: doc.tenant.profile_id,
        title: "Document Approved",
        message: `Your uploaded ${doc.doc_type} has been verified and approved by the owner.`,
        type: "INFO",
      },
    });

    // Check if all active documents are verified, then set document_verified status
    const allDocs = await prisma.identificationDocument.findMany({
      where: { tenant_id: tenantId, is_active: true, doc_type: { in: requiredDocumentTypes(doc.tenant.profile_type) } },
    });
    const allVerified = allDocs.length === requiredDocumentTypes(doc.tenant.profile_type).length && allDocs.every((d) => d.is_verified);
    if (allVerified) {
      await prisma.tenants.update({
        where: { id: tenantId },
        data: { document_verified: true },
      });
    }

    await eventLog.log("document_verified", doc.tenant.owner_id || null, {
      tenant_id: tenantId,
      document_id: docId,
      doc_type: doc.doc_type,
      approved_by: session.sub,
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
    console.error("Verify document error:", error);
    return NextResponse.json({ error: { message: "Internal server error" } }, { status: 500 });
  }
}
