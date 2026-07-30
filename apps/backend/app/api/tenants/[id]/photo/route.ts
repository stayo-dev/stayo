export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { imagekit } from "@/lib/imagekit";

/**
 * 📷 PROFILE PHOTO UPDATE
 * POST /api/tenants/[id]/photo
 *
 * Multipart form-data: field "file" (image/jpeg | image/png | image/webp, max 2MB)
 * Auth: TENANT (own) or OWNER (their tenant).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) return apiError("File is required", "VALIDATION", 400);

    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type))
      return apiError("Photo must be JPEG, PNG or WEBP", "VALIDATION", 400);
    if (file.size > 2 * 1024 * 1024)
      return apiError("Photo must be under 2MB", "VALIDATION", 400);

    const tenant = await prisma.tenants.findUnique({
      where: { id: params.id },
      select: { id: true, profile_id: true, owner_id: true },
    });
    if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);
    if (session.role === "TENANT" && tenant.profile_id !== session.sub) {
      return apiError("Access denied", "FORBIDDEN", 403);
    }
    if (session.role === "OWNER" && tenant.owner_id !== session.sub) {
      return apiError("Access denied", "FORBIDDEN", 403);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const upload = await imagekit.files.upload({
      file: buffer.toString("base64"),
      fileName: file.name || "photo.jpg",
      folder: `tenants/${tenant.id}/profile`,
      useUniqueFileName: true,
      tags: ["PROFILE_PHOTO", tenant.id],
    });

    const result = await prisma.tenants.update({
      where: { id: tenant.id },
      data: { photo_url: upload.url },
      select: { id: true, photo_url: true },
    });

    return apiResponse(result);
  } catch (error: any) {
    const msg = typeof error?.message === "string" ? error.message : String(error);
    if (msg.startsWith("VALIDATION")) return apiError(msg.split(": ")[1] ?? msg, "VALIDATION", 400);
    if (msg.startsWith("FORBIDDEN"))  return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("NOT_FOUND"))  return apiError(msg.split(": ")[1] ?? msg, "NOT_FOUND", 404);
    return apiError(msg || "Failed to upload photo");
  }
}
