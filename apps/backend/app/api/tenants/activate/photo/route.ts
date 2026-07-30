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

    if (!token) return withOnboardingMetrics(apiError("token is required", "VALIDATION_ERROR", 400), { startedAt });
    if (!file) return withOnboardingMetrics(apiError("file is required", "VALIDATION_ERROR", 400), { startedAt });

    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      return withOnboardingMetrics(apiError("Photo must be JPEG, PNG, or WEBP", "VALIDATION_ERROR", 400), { startedAt });
    }
    if (file.size > 2 * 1024 * 1024) {
      return withOnboardingMetrics(apiError("Photo must be under 2MB", "VALIDATION_ERROR", 400), { startedAt });
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
      fileName: file.name || "profile.jpg",
      folder: `owners/${tenant.owner_id}/tenants/${tenant.id}/documents/PROFILE_PHOTO`,
      useUniqueFileName: true,
      tags: ["PROFILE_PHOTO", tenant.id],
    });

    const updated = await prisma.tenants.update({
      where: { id: tenant.id },
      data: { photo_url: upload.url },
      select: { id: true, photo_url: true },
    });

    return withOnboardingMetrics(apiResponse(updated), { startedAt, payload: updated, externalCalls });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return withOnboardingMetrics(apiError(msg || "Failed to upload photo during activation"), {
      startedAt,
      payload: { message: msg },
      externalCalls,
    });
  }
}
