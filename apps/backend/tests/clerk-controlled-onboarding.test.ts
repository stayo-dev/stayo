/**
 * Authentication never creates a Stayo account (ADR-176 Phase 3.1).
 *
 * Onboarding is controlled: owners exist after admin approval, tenants after an
 * owner's invitation. Signing in with Clerk proves who you are — it does not
 * enrol you. An email Clerk knows and we do not is `NO_STAYO_ACCOUNT`, not a
 * new profile.
 *
 * This deliberately covers Google, email OTP and phone OTP as one case: the
 * backend never sees the method. Every Clerk sign-in arrives as a session token
 * and resolves through the same path, so provider-specific provisioning cannot
 * creep in without changing this file.
 *
 * PURE — `@/lib/db` is mocked; nothing reaches a database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const prisma = vi.hoisted(() => ({
  profile: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  users: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/logger", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), metrics: vi.fn() }),
}));

import { ensureUserForClerkSession } from "@/src/services/auth/clerk-user-sync-service";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTE = fs.readFileSync(path.join(root, "app/api/auth/me/route.ts"), "utf8");

/** A `users` row already linked to a profile with the given role. */
const linked = (role: string) => ({
  id: "user-1",
  clerk_user_id: "user_2abc",
  is_active: true,
  profile_id: "profile-1",
  profile: { role },
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.profile.findUnique.mockResolvedValue(null);
  prisma.users.findUnique.mockResolvedValue(null);
  prisma.users.create.mockResolvedValue({
    id: "user-1",
    clerk_user_id: "user_2abc",
    is_active: true,
    profile_id: null,
    profile: null,
  });
});

describe("people we already know can sign in", () => {
  it("an invited tenant resolves to their profile and role", async () => {
    prisma.users.findUnique.mockResolvedValue(linked("TENANT"));

    const snapshot = await ensureUserForClerkSession({ clerkUserId: "user_2abc" });

    expect(snapshot).toMatchObject({ profileId: "profile-1", role: "TENANT", profileLinked: true });
    expect(prisma.profile.create).not.toHaveBeenCalled();
  });

  it("an approved owner resolves to their profile and role", async () => {
    prisma.users.findUnique.mockResolvedValue(linked("OWNER"));

    const snapshot = await ensureUserForClerkSession({ clerkUserId: "user_2abc" });

    expect(snapshot).toMatchObject({ profileId: "profile-1", role: "OWNER" });
    expect(prisma.profile.create).not.toHaveBeenCalled();
  });

  it("an already-linked account is idempotent — no second row, no re-link", async () => {
    prisma.users.findUnique.mockResolvedValue(linked("TENANT"));

    const first = await ensureUserForClerkSession({ clerkUserId: "user_2abc" });
    const second = await ensureUserForClerkSession({ clerkUserId: "user_2abc" });

    expect(first).toEqual(second);
    expect(first.created).toBe(false);
    expect(prisma.users.create).not.toHaveBeenCalled();
    expect(prisma.users.update).not.toHaveBeenCalled();
  });
});

describe("people we do not know are refused, whatever they signed in with", () => {
  // The backend cannot tell these apart, and that is the point: one path, one
  // rule. Email is present for Google/email-OTP and absent for phone-OTP.
  const methods: Array<[string, { clerkUserId: string; email?: string }]> = [
    ["Google", { clerkUserId: "user_2new", email: "stranger@example.com" }],
    ["email OTP", { clerkUserId: "user_2new", email: "stranger@example.com" }],
    ["phone OTP", { clerkUserId: "user_2new" }],
  ];

  it.each(methods)("an unknown %s user gets no profile and no account", async (_label, identity) => {
    prisma.users.findUnique.mockResolvedValue(null);
    prisma.profile.findUnique.mockResolvedValue(null); // no invitation, no approval

    const snapshot = await ensureUserForClerkSession(identity);

    expect(snapshot.profileId).toBeNull();
    expect(snapshot.profileLinked).toBe(false);
    expect(snapshot.role).toBeNull();
    expect(prisma.profile.create).not.toHaveBeenCalled();
    expect(prisma.profile.upsert).not.toHaveBeenCalled();
  });

  it("the route turns an unlinked identity into NO_STAYO_ACCOUNT", async () => {
    // The snapshot above is identity only; refusal is the route's job.
    expect(ROUTE).toMatch(/if \(!snapshot\.profileId\)[\s\S]{0,200}NO_STAYO_ACCOUNT/);
  });

  it("creates only a `users` row — identity, never authority", async () => {
    await ensureUserForClerkSession({ clerkUserId: "user_2new", email: "stranger@example.com" });

    expect(prisma.users.create).toHaveBeenCalledTimes(1);
    expect(Object.keys(prisma.users.create.mock.calls[0][0].data)).not.toContain("role");
  });
});

describe("webhook email-linking still works for pre-existing invited people", () => {
  it("links to a profile the owner already created, and reads its role", async () => {
    // The invitation created the `profiles` row before they ever signed in;
    // linking to it is not provisioning.
    prisma.users.findUnique.mockResolvedValue(null);
    prisma.profile.findUnique.mockResolvedValue({ id: "profile-1", login: null });
    prisma.users.create.mockResolvedValue(linked("TENANT"));

    const snapshot = await ensureUserForClerkSession({
      clerkUserId: "user_2abc",
      email: "invited@example.com",
    });

    expect(prisma.users.create.mock.calls[0][0].data.profile_id).toBe("profile-1");
    expect(snapshot.role).toBe("TENANT");
    expect(prisma.profile.create).not.toHaveBeenCalled();
  });
});
