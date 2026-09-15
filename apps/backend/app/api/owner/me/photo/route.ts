export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { checkOwnerPhoto, clearOwnerPhoto, saveOwnerPhoto } from "@/lib/owner-photo";

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
 *
 * The upload/clear logic lives in `lib/owner-photo.ts`, shared with the
 * admin's replacement route (ADR-200).
 */

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const problem = checkOwnerPhoto(file);
    if (problem) return apiError(problem, "VALIDATION_ERROR", 400);

    const saved = await saveOwnerPhoto(session.sub, file as File);
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
    const saved = await clearOwnerPhoto(session.sub);
    return apiResponse({ success: true, data: saved });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[owner.me.photo.DELETE]", msg);
    return apiError(msg || "Failed to remove photo");
  }
}
