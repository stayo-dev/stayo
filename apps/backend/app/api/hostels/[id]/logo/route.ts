export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";
import { imagekit } from "@/lib/imagekit";
import { eventLog } from "@/lib/services/event-log-service";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

async function assertOwnedHostel(hostelId: string, ownerId: string) {
  const hostel = await prisma.hostels.findFirst({
    where: { id: hostelId, owner_id: ownerId, status: { in: ["ACTIVE", "INACTIVE"] } },
    select: { id: true },
  });
  if (!hostel) throw new Error("FORBIDDEN: Hostel is not owned by the authenticated owner");
  return hostel;
}

function toApiError(error: any) {
  const msg = String(error?.message || "Failed to update logo");
  if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(":")[1]?.trim() || msg, "FORBIDDEN", 403);
  if (msg.startsWith("VALIDATION")) return apiError(msg.split(":")[1]?.trim() || msg, "VALIDATION_ERROR", 400);
  return apiError(msg, "ERROR", 500);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);
    await assertOwnedHostel(params.id, scope.owner_id);

    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) return apiError("No file uploaded", "VALIDATION", 400);
    if (!ALLOWED_MIME_TYPES.includes(file.type)) return apiError("Invalid file type. Only PNG, JPG, WEBP allowed", "VALIDATION", 400);
    if (file.size > MAX_FILE_SIZE_BYTES) return apiError("File size exceeds 2MB limit", "VALIDATION", 400);

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadResponse = await imagekit.files.upload({
      file: buffer.toString("base64"),
      fileName: `hostel_${params.id}_logo_${Date.now()}`,
      folder: "/hostel_logos",
      tags: ["logo", params.id],
    });
    if (!uploadResponse?.url) throw new Error("Provider failed to return URL");

    const updatedHostel = await prisma.hostels.update({
      where: { id: params.id },
      data: { logo_url: uploadResponse.url },
      select: { logo_url: true },
    });

    await eventLog.log("HOSTEL_POLICY_UPDATED", scope.owner_id, {
      hostel_id: params.id,
      changed_by: scope.actor_id,
      changed_domains: ["branding"],
      field: "logo_upload",
    });

    return apiResponse({ success: true, logo_url: updatedHostel.logo_url });
  } catch (error: any) {
    console.error("[HOSTEL_LOGO_UPLOAD_ERROR]:", error);
    return toApiError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);
    await assertOwnedHostel(params.id, scope.owner_id);

    await prisma.hostels.update({ where: { id: params.id }, data: { logo_url: null } });
    await eventLog.log("HOSTEL_POLICY_UPDATED", scope.owner_id, {
      hostel_id: params.id,
      changed_by: scope.actor_id,
      changed_domains: ["branding"],
      field: "logo_removed",
    });

    return apiResponse({ success: true, logo_url: null });
  } catch (error: any) {
    console.error("[HOSTEL_LOGO_DELETE_ERROR]:", error);
    return toApiError(error);
  }
}
