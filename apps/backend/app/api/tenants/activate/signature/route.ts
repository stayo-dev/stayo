export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { imagekit } from "@/lib/imagekit";
import { withOnboardingMetrics } from "@/lib/onboarding-metrics";
import { tenantInvitationLifecycleService } from "@/src/services/tenants/tenant-invitation-lifecycle-service";

export async function POST(req: NextRequest) {
  const startedAt = performance.now();
  let externalCalls = 0;
  try {
    const formData = await req.formData();
    const token = formData.get("token") as string | null;
    const file = formData.get("file") as File | null;
    const signatureType = String(formData.get("type") || "tenant").toLowerCase(); // "tenant" or "guardian"

    if (!token) return withOnboardingMetrics(apiError("token is required", "VALIDATION_ERROR", 400), { startedAt });
    if (!file) return withOnboardingMetrics(apiError("file is required", "VALIDATION_ERROR", 400), { startedAt });

    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      return withOnboardingMetrics(apiError("Signature must be JPEG, PNG, or WEBP", "VALIDATION_ERROR", 400), { startedAt });
    }
    if (file.size > 2 * 1024 * 1024) {
      return withOnboardingMetrics(apiError("Signature must be under 2MB", "VALIDATION_ERROR", 400), { startedAt });
    }

    const resolved = await tenantInvitationLifecycleService.resolveByToken(token);
    if (!resolved.tenant) {
      return withOnboardingMetrics(apiError("Invalid or expired activation link", "INVALID", 410), { startedAt });
    }

    const tenant = resolved.tenant;

    const buffer = Buffer.from(await file.arrayBuffer());
    externalCalls = 1;
    const upload = await imagekit.files.upload({
      file: buffer.toString("base64"),
      fileName: `${signatureType}_signature_${Date.now()}.png`,
      folder: `owners/${tenant.owner_id}/tenants/${tenant.id}/signatures`,
      useUniqueFileName: true,
      tags: ["SIGNATURE", signatureType, tenant.id],
    });

    return withOnboardingMetrics(apiResponse({ url: upload.url }), { startedAt, payload: { url: upload.url }, externalCalls });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return withOnboardingMetrics(apiError(msg || "Failed to upload signature during activation"), {
      startedAt,
      payload: { message: msg },
      externalCalls,
    });
  }
}
