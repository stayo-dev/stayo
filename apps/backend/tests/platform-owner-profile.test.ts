import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getOrCreatePlatformOwnerProfile } from "@/src/services/marketing/platform-owner";

const PLATFORM_OWNER_EMAIL = "platform-listings@stayo.internal";

/**
 * The sentinel row is only removed while nothing owns hostels through it —
 * once a platform listing exists, deleting it would orphan that listing, and
 * the create path is then simply not reachable from this database.
 */
async function removeSentinelIfUnused() {
  const sentinel = await prisma.profile.findUnique({
    where: { email: PLATFORM_OWNER_EMAIL },
    select: { id: true },
  });
  if (!sentinel) return;
  const owned = await prisma.hostels.count({ where: { owner_id: sentinel.id } });
  if (owned === 0) await prisma.profile.delete({ where: { id: sentinel.id } });
}

describe("getOrCreatePlatformOwnerProfile", () => {
  beforeAll(removeSentinelIfUnused);
  afterAll(removeSentinelIfUnused);

  /**
   * Regression: profiles.id has no database default — real accounts reuse
   * their Supabase auth user id. The sentinel has no auth user, so creating
   * it without an explicit id failed with "Argument `id` is missing", which
   * made creating the first Stayo-listed hostel impossible.
   */
  it("creates the sentinel on first use with a generated uuid", async () => {
    const id = await getOrCreatePlatformOwnerProfile();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    const row = await prisma.profile.findUnique({
      where: { id },
      select: { email: true, role: true, is_active: true, password_hash: true, auth_user_id: true },
    });
    expect(row).toEqual({
      email: PLATFORM_OWNER_EMAIL,
      role: "OWNER",
      // Never signable-in: a foreign-key placeholder, not an account.
      is_active: false,
      password_hash: null,
      auth_user_id: null,
    });
  });

  it("returns the same row on every later call rather than creating another", async () => {
    const first = await getOrCreatePlatformOwnerProfile();
    const second = await getOrCreatePlatformOwnerProfile();
    expect(second).toBe(first);
    expect(await prisma.profile.count({ where: { email: PLATFORM_OWNER_EMAIL } })).toBe(1);
  });
});
