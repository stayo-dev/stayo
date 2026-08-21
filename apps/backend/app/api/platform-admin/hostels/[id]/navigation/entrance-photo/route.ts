export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { imagekit } from "@/lib/imagekit";

/**
 * The photo of the actual entrance, shown on the listing under "Look for this
 * entrance".
 *
 * **ADMIN only**, like the rest of navigation — this photo is the thing a student
 * matches against a real gate at night, and an owner able to swap it could point
 * arrivals at a nicer-looking door than their own.
 *
 * Returns a URL and writes nothing: the drawer holds it in draft state and the
 * PUT alongside persists it. Same split as the owner's listing photo upload, and
 * for the same reason — an upload that half-saves a record is worse than one that
 * hands back a URL the caller decides what to do with.
 */

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id } = await params;

  try {
    const hostel = await prisma.hostels.findUnique({ where: { id }, select: { id: true } });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return apiError("No photo was uploaded", "VALIDATION_ERROR", 422);

    if (!ALLOWED_TYPES.includes(file.type)) {
      return apiError(
        `${file.name || "That file"} is not a JPG, PNG or WebP image`,
        "VALIDATION_ERROR",
        422,
      );
    }
    if (file.size > MAX_BYTES) {
      return apiError(
        `${file.name || "That file"} is larger than ${MAX_BYTES / (1024 * 1024)}MB`,
        "VALIDATION_ERROR",
        422,
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const response = await imagekit.files.upload({
      file: buffer.toString("base64"),
      fileName: `hostel_${id}_entrance_${Date.now()}`,
      folder: "/hostel_entrances",
      tags: ["entrance", id],
    });
    if (!response?.url) throw new Error("Photo provider did not return a URL");

    return apiResponse({ url: response.url });
  } catch (error: any) {
    return apiError(error?.message || "Failed to upload the entrance photo");
  }
}
