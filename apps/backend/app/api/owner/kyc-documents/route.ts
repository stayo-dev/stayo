export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { imagekit } from "@/lib/imagekit";
import { eventLog } from "@/lib/services/event-log-service";

const DOC_TYPES = ["AADHAAR", "PAN", "PHOTO"] as const;
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Owner KYC documents (ADR-038).
 *
 * The onboarding KYC step used to be three toggles that uploaded nothing while
 * claiming documents were "auto-verified" — an owner could believe they were
 * verified when no file had ever left their device. This is the real thing.
 *
 * `status` is always PENDING on upload and can only be changed by an admin
 * review; nothing a user sends can mark their own document verified.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  const documents = await (prisma as any).owner_documents.findMany({
    where: { profile_id: session.sub, is_active: true },
    select: { id: true, doc_type: true, file_url: true, status: true, uploaded_at: true },
    orderBy: { uploaded_at: "desc" },
  });

  return apiResponse({ documents });
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  try {
    const formData = await req.formData();
    const docType = String(formData.get("doc_type") || "").toUpperCase();
    const file = formData.get("file") as File | null;

    if (!DOC_TYPES.includes(docType as (typeof DOC_TYPES)[number])) {
      return apiError(`doc_type must be one of ${DOC_TYPES.join(", ")}`, "VALIDATION_ERROR", 400);
    }
    if (!file) return apiError("No file uploaded", "VALIDATION_ERROR", 400);
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return apiError("Only PNG, JPG, WEBP or PDF are accepted", "VALIDATION_ERROR", 400);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return apiError("File size exceeds the 5MB limit", "VALIDATION_ERROR", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadResponse = await imagekit.files.upload({
      file: buffer.toString("base64"),
      fileName: `owner_${session.sub}_${docType.toLowerCase()}_${Date.now()}`,
      // Private folder — these are identity documents, not public assets.
      folder: "/owner_kyc",
      tags: ["owner-kyc", docType, session.sub],
    });
    if (!uploadResponse?.url) throw new Error("Provider failed to return a URL");

    // Supersede rather than overwrite: the previous upload stays as history.
    const created = await prisma.$transaction(async (tx: any) => {
      await tx.owner_documents.updateMany({
        where: { profile_id: session.sub, doc_type: docType, is_active: true },
        data: { is_active: false },
      });
      return tx.owner_documents.create({
        data: {
          profile_id: session.sub,
          doc_type: docType,
          file_url: uploadResponse.url,
          file_id: (uploadResponse as any).fileId ?? null,
          mime_type: file.type,
          file_size: file.size,
          status: "PENDING",
        },
        select: { id: true, doc_type: true, file_url: true, status: true, uploaded_at: true },
      });
    });

    await eventLog.log("OWNER_KYC_DOCUMENT_UPLOADED", session.sub, {
      doc_type: docType,
      document_id: created.id,
    });

    return apiResponse({ document: created }, 201);
  } catch (error: any) {
    console.error("[OWNER_KYC_UPLOAD_ERROR]:", error);
    return apiError("Could not upload the document. Please try again.", "INTERNAL_ERROR", 500);
  }
}
