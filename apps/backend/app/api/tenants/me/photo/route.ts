export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { imagekit } from "@/lib/imagekit";

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return apiError("file is required", "VALIDATION_ERROR", 400);

    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      return apiError("Photo must be JPEG, PNG, or WEBP", "VALIDATION_ERROR", 400);
    }
    if (file.size > 2 * 1024 * 1024) {
      return apiError("Photo must be under 2MB", "VALIDATION_ERROR", 400);
    }

    const tenant = await prisma.tenants.findUnique({
      where: { profile_id: session.sub },
      select: { id: true, owner_id: true },
    });
    if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);

    const buffer = Buffer.from(await file.arrayBuffer());
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

    return apiResponse(updated);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return apiError(msg || "Failed to upload photo");
  }
}
