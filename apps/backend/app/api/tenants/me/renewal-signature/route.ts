export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { imagekit } from "@/lib/imagekit";

/**
 * Signature upload for an already-authenticated tenant signing a renewal
 * agreement (post-acceptance). Mirrors `tenants/activate/signature/route.ts`'s
 * ImageKit upload, but resolves the tenant from the session instead of a
 * one-time activation token, since a renewal happens well after activation.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const tenant = await prisma.tenants.findFirst({
      where: {
        OR: [{ profile_id: session.sub }, ...(session.tenant_id ? [{ id: session.tenant_id }] : [])],
      },
      select: { id: true, owner_id: true },
    });
    if (!tenant) return apiError("Tenant not found", "TENANT_NOT_FOUND", 404);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const signatureType = String(formData.get("type") || "tenant").toLowerCase(); // "tenant" or "guardian"

    if (!file) return apiError("file is required", "VALIDATION_ERROR", 400);

    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      return apiError("Signature must be JPEG, PNG, or WEBP", "VALIDATION_ERROR", 400);
    }
    if (file.size > 2 * 1024 * 1024) {
      return apiError("Signature must be under 2MB", "VALIDATION_ERROR", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const upload = await imagekit.files.upload({
      file: buffer.toString("base64"),
      fileName: `${signatureType}_renewal_signature_${Date.now()}.png`,
      folder: `owners/${tenant.owner_id}/tenants/${tenant.id}/signatures`,
      useUniqueFileName: true,
      tags: ["SIGNATURE", "RENEWAL", signatureType, tenant.id],
    });

    return apiResponse({ url: upload.url });
  } catch (error: any) {
    return apiError(error.message || "Failed to upload renewal signature");
  }
}
