export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { eventLog } from "@/lib/services/event-log-service";
import crypto from "crypto";

const requiredDocumentTypes = (profileType?: string | null) =>
  String(profileType || "STUDENT").toUpperCase() === "WORKING_PROFESSIONAL"
    ? ["AADHAAR", "WORK_ID"]
    : ["AADHAAR", "COLLEGE_ID"];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(req);
    if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
      return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
    }

    const tenant = await prisma.tenants.findUnique({
      where: { id: params.id },
      include: { profiles: true },
    });

    if (!tenant) {
      return NextResponse.json({ error: { message: "Tenant not found" } }, { status: 404 });
    }
    if (session.role === "OWNER" && tenant.owner_id !== session.sub) {
      return NextResponse.json({ error: { message: "Forbidden" } }, { status: 403 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const requiredTypes = requiredDocumentTypes(tenant.profile_type);
      const activeDocs = await tx.identificationDocument.findMany({
        where: { tenant_id: tenant.id, is_active: true, doc_type: { in: requiredTypes } },
        select: { id: true, doc_type: true, document_status: true, is_verified: true },
      });

      const pendingDocs = activeDocs.filter((doc) => doc.document_status !== "APPROVED" || !doc.is_verified);
      if (activeDocs.length === 0) {
        return { active_count: 0, verified_count: 0, document_ids: [] as string[] };
      }

      await tx.identificationDocument.updateMany({
        where: { tenant_id: tenant.id, is_active: true, doc_type: { in: requiredTypes } },
        data: {
          document_status: "APPROVED",
          is_verified: true,
          approved_by: session.sub,
          approved_at: new Date(),
        },
      });

      await tx.tenants.update({
        where: { id: tenant.id },
        data: { document_verified: true },
      });

      return {
        active_count: activeDocs.length,
        verified_count: pendingDocs.length,
        document_ids: activeDocs.map((doc) => doc.id),
      };
    });

    if (result.active_count === 0) {
      return NextResponse.json({ error: { message: "No active documents to verify" } }, { status: 409 });
    }

    await prisma.notifications.create({
      data: {
        id: crypto.randomUUID(),
        profile_id: tenant.profile_id,
        title: "Documents Approved",
        message: "All active documents submitted to your hostel have been verified.",
        type: "INFO",
      },
    });

    await eventLog.log("documents_bulk_verified", tenant.owner_id || null, {
      tenant_id: tenant.id,
      document_ids: result.document_ids,
      verified_by: session.sub,
    }, tenant.id);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Bulk verify documents error:", error);
    return NextResponse.json({ error: { message: "Internal server error" } }, { status: 500 });
  }
}
