export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { imagekit } from "@/lib/imagekit";
import { requireAdminOrManagerPermission } from "@/src/services/managers/manager-authorization";
import { ownerBillingErrorResponse } from "@/src/services/owner-billing/owner-http";

/**
 * POST /api/platform-admin/owner-payments/proof   (multipart, field: `file`)
 *
 * Uploads a generic owner-payment proof (screenshot / PDF) for an admin/
 * manager recording a manual payment, and returns `{ url }`. Same two-step
 * upload-then-submit split as `owner/subscription/payments/proof/route.ts`,
 * reusing the same ImageKit client with its own `/owner_payment_proofs`
 * folder so this feature's proofs never mix with subscription proofs.
 */
const ALLOWED = ["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"];
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  try {
    await requireAdminOrManagerPermission(session, "MANAGE_SUBSCRIPTIONS");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return apiError("No file uploaded", "VALIDATION_ERROR", 422);
    if (!ALLOWED.includes(file.type)) {
      return apiError("Upload a PNG, JPG, WebP or PDF", "VALIDATION_ERROR", 422);
    }
    if (file.size > MAX_BYTES) {
      return apiError(`File is larger than ${MAX_BYTES / (1024 * 1024)}MB`, "VALIDATION_ERROR", 422);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploaded = await imagekit.files.upload({
      file: buffer.toString("base64"),
      fileName: `owner_payment_proof_${(session as any).sub}_${Date.now()}`,
      folder: "/owner_payment_proofs",
      tags: ["owner-payment-proof", (session as any).sub],
    });
    if (!uploaded?.url) throw new Error("Provider did not return a URL");

    return apiResponse({ url: uploaded.url }, 201);
  } catch (error) {
    return ownerBillingErrorResponse(error, "platform-admin.owner-payments.proof");
  }
}
