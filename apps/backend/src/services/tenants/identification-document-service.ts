import type { Prisma, PrismaClient } from "@prisma/client";
import { backendUrl } from "@/lib/config/domains";

/**
 * Shared helpers for `identification_documents` (tenant KYC).
 *
 * Both upload paths — `POST /api/tenants/me/documents` (session) and
 * `POST /api/tenants/activate/documents` (activation token/session) — write the
 * same rows the same way, so the archive-then-create lives here rather than
 * being copied into each route.
 */

type TxClient = Prisma.TransactionClient | PrismaClient;

export type UploadedFileRef = {
  url: string | null | undefined;
  filePath: string | null | undefined;
  fileId: string | null | undefined;
};

/** Strip the storage columns before a document ever reaches a client. */
export function publicDocument(doc: any, tenantId: string) {
  const { file_url, file_path, file_id, ...safeDoc } = doc;
  return {
    ...safeDoc,
    download_url: backendUrl(`/api/tenants/${tenantId}/documents/${doc.id}/download`),
  };
}

/**
 * Retire the tenant's current active document of this type and create a fresh
 * PENDING one. Retried once on a unique-constraint hit, which is how two
 * concurrent uploads of the same type resolve — one active row per
 * `(tenant_id, doc_type)` (migration 080's partial unique index).
 *
 * Caller is responsible for `recomputeDocumentVerified` afterwards, inside the
 * same transaction.
 */
export async function createSupersedingDocument(
  tx: TxClient,
  args: {
    tenantId: string;
    docType: string;
    docNumber?: string | null;
    file: UploadedFileRef;
    mimeType: string;
    fileSize: number;
    uploadedBy?: string | null;
  },
) {
  const run = async () => {
    await tx.identificationDocument.updateMany({
      where: { tenant_id: args.tenantId, doc_type: args.docType, is_active: true },
      data: { is_active: false },
    });
    if (!args.file.url) throw new Error("Upload did not return a file URL");
    return tx.identificationDocument.create({
      data: {
        tenant_id: args.tenantId,
        doc_type: args.docType,
        doc_number: args.docNumber ?? null,
        file_url: String(args.file.url),
        file_path: args.file.filePath ? String(args.file.filePath) : null,
        file_id: args.file.fileId ? String(args.file.fileId) : null,
        mime_type: args.mimeType,
        file_size: args.fileSize,
        document_status: "PENDING",
        is_verified: false,
        uploaded_by: args.uploadedBy ?? null,
      },
    });
  };

  try {
    return await run();
  } catch (error: any) {
    if (error?.code === "P2002") return run();
    throw error;
  }
}
