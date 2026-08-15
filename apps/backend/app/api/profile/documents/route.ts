export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { documentVaultService } from "@/src/services/profile/document-vault-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

const AddDocumentSchema = z.object({
  doc_type: z.string().min(1).max(40),
  doc_number: z.string().max(60).optional().nullable(),
  file_url: z.string().url(),
  file_path: z.string().max(500).optional().nullable(),
  file_id: z.string().max(200).optional().nullable(),
  mime_type: z.string().min(1).max(120),
  file_size: z.number().int().positive(),
});

/** The person's own vault — every document, and each hostel's verdict on it. */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) throw ApiError.unauthorized("Sign in to continue");

    const documents = await documentVaultService.listForProfile(session.sub);
    return ApiResponse.success(documents);
  } catch (error) {
    return ApiResponse.error(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) throw ApiError.unauthorized("Sign in to continue");

    const body = await req.json().catch(() => ({}));
    const parsed = AddDocumentSchema.safeParse(body);
    if (!parsed.success) throw ApiError.validationError("Check the document details and try again");

    const document = await documentVaultService.addDocument(session.sub, parsed.data);
    return ApiResponse.success(document, "Document added to your vault");
  } catch (error) {
    return ApiResponse.error(error);
  }
}
