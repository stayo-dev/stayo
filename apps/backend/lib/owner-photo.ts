import { prisma } from "@/lib/db";
import { imagekit } from "@/lib/imagekit";

/**
 * One shape for "a photo of an owner", shared by the owner's own upload
 * (`owner/me/photo`) and an admin's replacement (`platform-admin/owners/[id]/photo`).
 * Stored on `profile_identity`, never on `profile` — see `owner/me/photo` for why.
 */

export const OWNER_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const OWNER_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export function checkOwnerPhoto(file: File | null): string | null {
  if (!file) return "file is required";
  if (!OWNER_PHOTO_TYPES.includes(file.type)) return "Photo must be JPEG, PNG, or WEBP";
  if (file.size > OWNER_PHOTO_MAX_BYTES) return "Photo must be under 2MB";
  return null;
}

export async function saveOwnerPhoto(profileId: string, file: File, extraTags: string[] = []) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const upload = await imagekit.files.upload({
    file: buffer.toString("base64"),
    fileName: file.name || "profile.jpg",
    folder: `owners/${profileId}/profile`,
    useUniqueFileName: true,
    tags: ["OWNER_PROFILE_PHOTO", profileId, ...extraTags],
  });
  // Upsert: an owner who has never filled in any identity field has no
  // `profile_identity` row yet, and a photo must not require one.
  return prisma.profile_identity.upsert({
    where: { profile_id: profileId },
    create: { profile_id: profileId, photo_url: upload.url },
    update: { photo_url: upload.url },
    select: { photo_url: true },
  });
}

/**
 * Clears the reference only; the ImageKit asset is left in place. Deleting
 * the remote file makes the action irreversible and couples it to an external
 * service being reachable, for no benefit anyone can see.
 */
export async function clearOwnerPhoto(profileId: string) {
  const existing = await prisma.profile_identity.findUnique({
    where: { profile_id: profileId },
    select: { profile_id: true },
  });
  if (!existing) return { photo_url: null };
  return prisma.profile_identity.update({
    where: { profile_id: profileId },
    data: { photo_url: null },
    select: { photo_url: true },
  });
}
