import { prisma } from "@/lib/db";

/**
 * The sentinel profile that owns Stayo-authored listings until a real owner
 * claims them.
 *
 * This exists so `hostels.owner_id` can stay NOT NULL. The alternative —
 * nullable ownership — would force every owner-scoped query in the codebase to
 * handle a hostel with nobody, and `architectural-invariants-check.ts` already
 * forbids treating hostel ownership as optional. One sentinel row keeps all of
 * that untouched.
 *
 * It is deliberately `is_active: false` and has no usable credentials: nothing
 * should ever be able to sign in as it. It is a placeholder for a foreign key,
 * not an account.
 */
const PLATFORM_OWNER_EMAIL = "platform-listings@stayo.internal";

export async function getOrCreatePlatformOwnerProfile(): Promise<string> {
  const existing = await prisma.profile.findUnique({
    where: { email: PLATFORM_OWNER_EMAIL },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.profile.create({
    data: {
      email: PLATFORM_OWNER_EMAIL,
      name: "Stayo Platform",
      role: "OWNER",
      // Never signable-in: this is a foreign-key placeholder, not an account.
      is_active: false,
      is_profile_completed: true,
    },
    select: { id: true },
  });
  return created.id;
}
