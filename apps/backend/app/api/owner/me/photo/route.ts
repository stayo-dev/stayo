export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { imagekit } from "@/lib/imagekit";

/**
 * 👤 OWNER PROFILE PHOTO
 * POST   — upload/replace the owner's photo
 * DELETE — remove it
 *
 * **Stored on `profile_identity`, never on `profile`.** `getSession()` reads a
 * profile on every authenticated request for every role, and Prisma selects
 * the full column set on any query without an explicit `select` — that is the
 * mechanism behind the 2026-08-14 outage, and the reason `profile_identity`
 * exists as a home for rarely-read person-level fields. `photo_url` is already
 * one of its columns (it holds the tenant's photo today), so this adds no
 * schema change and no migration: an owner is a person with a profile row like
 * any other.
 *
 * Mirrors `tenants/me/photo` deliberately — same 2MB cap, same three accepted
 * types, same ImageKit call — so there is one shape for "upload a photo of a
 * person" rather than two that drift.
 */

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return apiError("file is required", "VALIDATION_ERROR", 400);

    if (!ALLOWED.includes(file.type)) {
      return apiError("Photo must be JPEG, PNG, or WEBP", "VALIDATION_ERROR", 400);
    }
    if (file.size > MAX_BYTES) {
      return apiError("Photo must be under 2MB", "VALIDATION_ERROR", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const upload = await imagekit.files.upload({
      file: buffer.toString("base64"),
      fileName: file.name || "profile.jpg",
      folder: `owners/${session.sub}/profile`,
      useUniqueFileName: true,
      tags: ["OWNER_PROFILE_PHOTO", session.sub],
    });

    // Upsert: an owner who has never filled in any identity field has no
    // `profile_identity` row yet, and uploading a photo must not require them
    // to have one already.
    const saved = await prisma.profile_identity.upsert({
      where: { profile_id: session.sub },
      create: { profile_id: session.sub, photo_url: upload.url },
      update: { photo_url: upload.url },
      select: { photo_url: true },
    });

    return apiResponse({ success: true, data: saved });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[owner.me.photo.POST]", msg);
    return apiError(msg || "Failed to upload photo");
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    // Clears the reference only; the ImageKit asset is left in place. Deleting
    // the remote file on a "remove photo" tap makes the action irreversible
    // and couples this route to an external service being reachable, for no
    // benefit an owner can see.
    const existing = await prisma.profile_identity.findUnique({
      where: { profile_id: session.sub },
      select: { profile_id: true },
    });
    if (!existing) return apiResponse({ success: true, data: { photo_url: null } });

    const saved = await prisma.profile_identity.update({
      where: { profile_id: session.sub },
      data: { photo_url: null },
      select: { photo_url: true },
    });

    return apiResponse({ success: true, data: saved });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[owner.me.photo.DELETE]", msg);
    return apiError(msg || "Failed to remove photo");
  }
}
