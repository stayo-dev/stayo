export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { backendUrl } from "@/lib/config/domains";
import { currentAgreementWhere } from "@/src/services/tenants/agreement-status";
import { requiredKycDocTypes as requiredDocumentTypes } from "@/src/services/tenants/kyc-status";
import { publicDocument } from "@/src/services/tenants/identification-document-service";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(req);
    if (!session) {
      return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
    }

    const { id } = params;

    // Owners see documents of their tenants, tenants can only see their own.
    // Admin may inspect across owners.
    let tenantProfileType: string | null | undefined;
    if (session.role === "TENANT") {
      const tenant = await prisma.tenants.findUnique({
        where: { profile_id: session.sub },
        select: { id: true, profile_type: true },
      });
      if (!tenant || tenant.id !== id) {
        return NextResponse.json({ error: { message: "Forbidden" } }, { status: 403 });
      }
      tenantProfileType = tenant.profile_type;
    } else if (session.role === "OWNER") {
      const tenant = await prisma.tenants.findFirst({
        where: { id, owner_id: session.sub },
        select: { id: true, profile_type: true },
      });
      if (!tenant) {
        return NextResponse.json({ error: { message: "Forbidden" } }, { status: 403 });
      }
      tenantProfileType = tenant.profile_type;
    } else if (session.role !== "ADMIN") {
      return NextResponse.json({ error: { message: "Forbidden" } }, { status: 403 });
    } else {
      const tenant = await prisma.tenants.findUnique({
        where: { id },
        select: { profile_type: true },
      });
      tenantProfileType = tenant?.profile_type;
    }

    const requiredDocuments = requiredDocumentTypes(tenantProfileType);
    const documents = await prisma.identificationDocument.findMany({
      where: {
        tenant_id: id,
        is_active: true,
        doc_type: { in: requiredDocuments },
      },
      orderBy: {
        created_at: "desc",
      },
    });

    const agreements = await prisma.agreement.findMany({
      where: { tenant_id: id, status: currentAgreementWhere() },
      orderBy: { generated_at: "desc" },
    });

    const signedAgreement = agreements[0] || null;
    const agreementVirtualDoc = signedAgreement ? {
      id: signedAgreement.id,
      tenant_id: id,
      doc_type: "RENTAL_AGREEMENT",
      doc_number: null,
      mime_type: "application/pdf",
      file_size: 0,
      document_status: "APPROVED",
      is_verified: true,
      is_active: true,
      download_url: backendUrl(`/api/tenants/${id}/documents/${signedAgreement.id}/download`),
    } : null;

    const mappedDocs = documents.map((doc) => publicDocument(doc, id));
    if (agreementVirtualDoc) {
      mappedDocs.push(agreementVirtualDoc);
    }

    return NextResponse.json({
      success: true,
      data: {
        documents: mappedDocs,
        required_documents: requiredDocuments,
      },
    });
  } catch (error) {
    console.error("Fetch documents error:", error);
    return NextResponse.json({ error: { message: "Internal server error" } }, { status: 500 });
  }
}
