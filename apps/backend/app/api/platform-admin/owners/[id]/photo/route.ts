export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { checkOwnerPhoto, clearOwnerPhoto, saveOwnerPhoto } from "@/lib/owner-photo";

/**
 * POST   /api/platform-admin/owners/[id]/photo — replace an owner's photo
 * DELETE /api/platform-admin/owners/[id]/photo — remove it
 *
 * ADR-200 admin override. Same helper, cap and types as the owner's own
 * upload. To keep a photo off the listing without deleting it, use the
 * host-profile `photo_hidden` flag instead.
 */

async function guard(req: NextRequest, ownerId: string) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") return { error: apiError("Admin access only", "FORBIDDEN", 403) };
  const owner = await prisma.profile.findFirst({ where: { id: ownerId, role: "OWNER" }, select: { id: true } });
  if (!owner) return { error: apiError("Owner not found", "NOT_FOUND", 404) };
  return { session };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { error, session } = await guard(req, params.id);
    if (error) return error;
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const problem = checkOwnerPhoto(file);
    if (problem) return apiError(problem, "VALIDATION_ERROR", 400);

    const saved = await saveOwnerPhoto(params.id, file as File, ["ADMIN_REPLACED"]);
    await eventLog.log("OWNER_HOST_PROFILE_ADMIN_EDIT", params.id, { fields: ["photo"], admin_id: session!.sub });
    return apiResponse({ data: saved });
  } catch (error: unknown) {
    console.error("[platform-admin.owners.photo.POST]", error instanceof Error ? error.message : String(error));
    return apiError("Failed to upload photo");
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { error, session } = await guard(req, params.id);
    if (error) return error;
    const saved = await clearOwnerPhoto(params.id);
    await eventLog.log("OWNER_HOST_PROFILE_ADMIN_EDIT", params.id, { fields: ["photo"], admin_id: session!.sub });
    return apiResponse({ data: saved });
  } catch (error: unknown) {
    console.error("[platform-admin.owners.photo.DELETE]", error instanceof Error ? error.message : String(error));
    return apiError("Failed to remove photo");
  }
}
