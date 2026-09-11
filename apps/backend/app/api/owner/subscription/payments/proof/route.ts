export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { imagekit } from "@/lib/imagekit";

/**
 * POST /api/owner/subscription/payments/proof   (multipart, field: `file`)
 *
 * Uploads a subscription-payment proof (screenshot / PDF) and returns
 * `{ url }`. The owner then submits `POST /api/owner/subscription/payments`
 * with that `proof_file_url` — same two-step split as the owner listing-photo
 * and entrance-photo uploads: an upload that half-saves a record is worse than
 * one that hands back a URL the caller decides what to do with.
 *
 * Owner-scoped by the session; never trusts an ownerId from the request.
 */
const ALLOWED = ["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"];
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Owner access only", "FORBIDDEN", 403);

  try {
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
      fileName: `sub_proof_${session.sub}_${Date.now()}`,
      folder: "/subscription_proofs",
      tags: ["subscription-proof", session.sub],
    });
    if (!uploaded?.url) throw new Error("Provider did not return a URL");

    return apiResponse({ url: uploaded.url }, 201);
  } catch (error: any) {
    console.error("Detailed API Error [owner.subscription.payments.proof]:", error);
    return apiError("Could not upload that file. Please try again.", "INTERNAL_ERROR", 500);
  }
}
