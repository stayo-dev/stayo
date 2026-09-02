import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { backendUrl } from "@/lib/config/domains";
import { currentAgreementWhere } from "@/src/services/tenants/agreement-status";
import { requiredKycDocTypes as requiredDocumentTypes } from "@/src/services/tenants/kyc-status";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(req);
    if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
      return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
    }

    const { id } = params;

    const ownerScope = session.role === "OWNER" ? resolveOwnerScope(session).owner_id : null;
    const tenant = await prisma.tenants.findFirst({
      where: {
        id,
        ...(ownerScope ? { owner_id: ownerScope } : {}),
      },
      include: {
        profiles: true,
        tenant_invitations: {
          orderBy: { created_at: "desc" },
          take: 1,
          select: { name: true, email: true, phone: true, status: true },
        },
        room_allocations: {
          where: { is_active: true, end_date: null },
          orderBy: { start_date: "desc" },
          take: 1,
          include: { room: true },
        },
        payments: {
          take: 5,
          orderBy: { created_at: "desc" },
        },
        rent_obligations: {
          take: 5,
          orderBy: { due_date: "desc" },
        },
        identification_documents: {
          where: { is_active: true },
          orderBy: { created_at: "desc" },
        },
        agreements: {
          where: { status: currentAgreementWhere() },
          orderBy: { generated_at: "desc" },
        },
      },
    });

    if (!tenant) {
      return NextResponse.json({ error: { message: "Tenant not found" } }, { status: 404 });
    }

    const requiredDocuments = requiredDocumentTypes(tenant.profile_type);
    const invitation = tenant.tenant_invitations?.[0] || null;
    const profile = tenant.profiles || (invitation
      ? { id: null, name: invitation.name, email: invitation.email, phone: invitation.phone }
      : null);

    const signedAgreement = tenant.agreements?.[0] || null;
    const agreementVirtualDoc = signedAgreement ? {
      id: signedAgreement.id,
      tenant_id: tenant.id,
      doc_type: "RENTAL_AGREEMENT",
      doc_number: null,
      mime_type: "application/pdf",
      file_size: 0,
      document_status: "APPROVED",
      is_verified: true,
      is_active: true,
      download_url: backendUrl(`/api/tenants/${tenant.id}/documents/${signedAgreement.id}/download`),
    } : null;

    const mappedDocs = (tenant.identification_documents || [])
      .filter((doc: any) => requiredDocuments.includes(doc.doc_type))
      .map((doc: any) => {
        const { file_url, file_path, file_id, ...safeDoc } = doc;
        return {
          ...safeDoc,
          download_url: backendUrl(`/api/tenants/${tenant.id}/documents/${doc.id}/download`),
        };
      });

    if (agreementVirtualDoc) {
      mappedDocs.push(agreementVirtualDoc);
    }

    return NextResponse.json({
      ...tenant,
      profiles: profile,
      profile,
      identification_documents: mappedDocs,
      required_document_types: requiredDocuments,
    });
  } catch (error) {
    console.error("Full profile fetch error:", error);
    return NextResponse.json({ error: { message: "Internal server error" } }, { status: 500 });
  }
}
