export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { imagekit } from "@/lib/imagekit";
import { eventLog } from "@/lib/services/event-log-service";
import { backendUrl } from "@/lib/config/domains";
import { currentAgreementWhere } from "@/src/services/tenants/agreement-status";

const allowedTypesForProfile = (profileType?: string | null) => {
  const type = String(profileType || "STUDENT").toUpperCase();
  return type === "WORKING_PROFESSIONAL" ? ["AADHAAR", "WORK_ID"] : ["AADHAAR", "COLLEGE_ID"];
};
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_SIZE = 5 * 1024 * 1024;

function publicDocument(doc: any, tenantId: string) {
  const { file_url, file_path, file_id, ...safeDoc } = doc;
  return {
    ...safeDoc,
    download_url: backendUrl(`/api/tenants/${tenantId}/documents/${doc.id}/download`),
  };
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const tenant = await prisma.tenants.findUnique({
    where: { profile_id: session.sub },
    select: { id: true, profile_type: true },
  });
  if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);

  const requiredDocuments = allowedTypesForProfile(tenant.profile_type);
  const documents = await prisma.identificationDocument.findMany({
    where: { tenant_id: tenant.id, is_active: true, doc_type: { in: requiredDocuments } },
    orderBy: { created_at: "desc" },
  });

  const agreements = await prisma.agreement.findMany({
    where: { tenant_id: tenant.id, status: currentAgreementWhere() },
    orderBy: { generated_at: "desc" },
  });

  const signedAgreement = agreements[0] || null;
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

  const mappedDocs = documents.map((doc) => publicDocument(doc, tenant.id));
  if (agreementVirtualDoc) {
    mappedDocs.push(agreementVirtualDoc);
  }

  return apiResponse({
    documents: mappedDocs,
    required_documents: requiredDocuments,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const tenant = await prisma.tenants.findUnique({
      where: { profile_id: session.sub },
      select: { id: true, owner_id: true, profile_type: true },
    });
    if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const docType = String(formData.get("doc_type") ?? "").toUpperCase();
    const docNumber = formData.get("doc_number") ? String(formData.get("doc_number")) : null;

    if (!file) return apiError("file is required", "VALIDATION_ERROR", 400);
    const allowedTypes = allowedTypesForProfile(tenant.profile_type);
    if (!allowedTypes.includes(docType)) {
      return apiError(`Invalid doc_type. Upload only ${allowedTypes.join(" and ")}.`, "VALIDATION_ERROR", 400);
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      return apiError("File must be JPG, PNG, WEBP, or PDF", "VALIDATION_ERROR", 400);
    }
    if (file.size > MAX_SIZE) {
      return apiError("File must be under 5MB", "VALIDATION_ERROR", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const upload = await imagekit.files.upload({
      file: buffer.toString("base64"),
      fileName: file.name || `${docType.toLowerCase()}.jpg`,
      folder: `owners/${tenant.owner_id}/tenants/${tenant.id}/documents/${docType}`,
      useUniqueFileName: true,
      tags: [docType, tenant.id],
    });

    const created = await prisma.$transaction(async (tx) => {
      await tx.identificationDocument.updateMany({
        where: { tenant_id: tenant.id, doc_type: docType, is_active: true },
        data: { is_active: false },
      });

      const document = await tx.identificationDocument.create({
        data: {
          tenant_id: tenant.id,
          doc_type: docType,
          doc_number: docNumber,
          file_url: upload.url,
          file_path: upload.filePath,
          file_id: upload.fileId,
          mime_type: file.type,
          file_size: file.size,
          document_status: "PENDING",
          is_verified: false,
          uploaded_by: session.sub,
        },
      });

      await tx.tenants.update({
        where: { id: tenant.id },
        data: { document_verified: false },
      });

      return document;
    });

    await eventLog.log("documents_uploaded", tenant.owner_id || null, {
      tenant_id: tenant.id,
      doc_type: docType,
      document_id: created.id,
    }, tenant.id);

    return apiResponse(publicDocument(created, tenant.id), 201);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return apiError(msg || "Failed to upload document");
  }
}
