export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { imagekit } from "@/lib/imagekit";
import { requireAdmin, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * POST /api/platform-admin/billing-settings/qr   (multipart, field: `file`)
 *
 * Uploads the Stayo payment QR image and returns `{ url }`. The admin then PUTs
 * `/billing-settings` with `qr_image_url`. Same two-step upload split as the
 * owner proof upload and entrance-photo upload.
 */
const ALLOWED = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return apiError("No file uploaded", "VALIDATION_ERROR", 422);
    if (!ALLOWED.includes(file.type)) return apiError("Upload a PNG, JPG or WebP image", "VALIDATION_ERROR", 422);
    if (file.size > MAX_BYTES) return apiError(`File is larger than ${MAX_BYTES / (1024 * 1024)}MB`, "VALIDATION_ERROR", 422);

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploaded = await imagekit.files.upload({
      file: buffer.toString("base64"),
      fileName: `stayo_billing_qr_${Date.now()}`,
      folder: "/platform_billing",
      tags: ["billing-qr"],
    });
    if (!uploaded?.url) throw new Error("Provider did not return a URL");
    return apiResponse({ url: uploaded.url }, 201);
  } catch (error) {
    return subscriptionErrorResponse(error, "platform-admin.billing-settings.qr");
  }
}
