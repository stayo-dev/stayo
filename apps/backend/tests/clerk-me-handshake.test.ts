/**
 * GET /me — the canonical Clerk handshake (ADR-176, Phase 2.6).
 *
 * The requirements under test are the ones that make this endpoint safe to
 * expose to any Clerk session: it is idempotent, it cannot produce a duplicate
 * user even under a race, it never assigns a business role, and it never
 * creates a profile. Authorisation stays in the database.
 *
 * PURE — `@/lib/db` is mocked, so no client is constructed and nothing reaches
 * a database.
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
import { extractBearerToken, readEmailClaim } from "@/lib/auth/clerk-session";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const ROW = {
  id: "user-row-1",
  clerk_user_id: "user_2abc",
  is_active: true,
  profile_id: null,
  profile: null,
};

function p2002() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.profile.findUnique.mockResolvedValue(null);
  prisma.users.findUnique.mockResolvedValue(null);
  prisma.users.create.mockResolvedValue(ROW);
});

// ── creates exactly once ────────────────────────────────────────────────────

describe("ensureUserForClerkSession — creating a missing user", () => {
  it("creates the row when none exists, and says so", async () => {
    const snapshot = await ensureUserForClerkSession({ clerkUserId: "user_2abc" });

    expect(prisma.users.create).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({
      userId: "user-row-1",
      clerkUserId: "user_2abc",
      created: true,
      isActive: true,
    });
  });

  it("creates a minimal row — clerk id, email, profile link, nothing else", async () => {
    await ensureUserForClerkSession({ clerkUserId: "user_2abc" });

    expect(Object.keys(prisma.users.create.mock.calls[0][0].data).sort()).toEqual([
      "clerk_user_id",
      "email",
      "profile_id",
    ]);
  });
});

describe("repeated requests never duplicate a user", () => {
  it("does not create when the row already exists", async () => {
    prisma.users.findUnique.mockResolvedValue(ROW);

    const snapshot = await ensureUserForClerkSession({ clerkUserId: "user_2abc" });

    expect(prisma.users.create).not.toHaveBeenCalled();
    expect(snapshot.created).toBe(false);
    expect(snapshot.userId).toBe("user-row-1");
  });

  it("creates on the first call and not on the second", async () => {
    // First call: absent, so it creates. Second: present, so it reads.
    const first = await ensureUserForClerkSession({ clerkUserId: "user_2abc" });
    prisma.users.findUnique.mockResolvedValue(ROW);
    const second = await ensureUserForClerkSession({ clerkUserId: "user_2abc" });

    expect(prisma.users.create).toHaveBeenCalledTimes(1);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.userId).toBe(first.userId);
  });

  it("survives a race: the loser of a concurrent insert re-reads instead of failing", async () => {
    // Both requests miss the read; the database's unique index is what actually
    // prevents the duplicate, so the loser must handle P2002 rather than 500.
    prisma.users.create.mockRejectedValueOnce(p2002());
    prisma.users.findUnique
      .mockResolvedValueOnce(null) // the initial miss
      .mockResolvedValueOnce(ROW); // the re-read after losing the race

    const snapshot = await ensureUserForClerkSession({ clerkUserId: "user_2abc" });

    expect(snapshot.created).toBe(false);
    expect(snapshot.userId).toBe("user-row-1");
    expect(prisma.users.create).toHaveBeenCalledTimes(1);
  });

  it("rethrows a non-uniqueness failure rather than inventing a snapshot", async () => {
    prisma.users.create.mockRejectedValueOnce(new Error("connection lost"));

    await expect(ensureUserForClerkSession({ clerkUserId: "user_2abc" })).rejects.toThrow(
      "connection lost",
    );
  });
});

// ── authority stays in the database ─────────────────────────────────────────

describe("authorisation continues to come from database roles only", () => {
  it("never writes a role", async () => {
    await ensureUserForClerkSession({ clerkUserId: "user_2abc" });

    expect(prisma.users.create.mock.calls[0][0].data).not.toHaveProperty("role");
  });

  it("reads the role from the linked profile", async () => {
    prisma.users.findUnique.mockResolvedValue({
      ...ROW,
      profile_id: "profile-1",
      profile: { role: "OWNER" },
    });

    const snapshot = await ensureUserForClerkSession({ clerkUserId: "user_2abc" });

    expect(snapshot).toMatchObject({ role: "OWNER", profileId: "profile-1", profileLinked: true });
  });

  it("reports no role for an unlinked account, rather than defaulting to one", async () => {
    prisma.users.findUnique.mockResolvedValue(ROW);

    const snapshot = await ensureUserForClerkSession({ clerkUserId: "user_2abc" });

    expect(snapshot.role).toBeNull();
    expect(snapshot.profileLinked).toBe(false);
  });

  it("never creates a profile", async () => {
    await ensureUserForClerkSession({ clerkUserId: "user_2abc", email: "ada@example.com" });

    expect(prisma.profile.create).not.toHaveBeenCalled();
    expect(prisma.profile.upsert).not.toHaveBeenCalled();
  });

  it("links to an existing profile by email, and does not steal a bound one", async () => {
    prisma.profile.findUnique.mockResolvedValue({
      id: "profile-1",
      login: { clerk_user_id: "user_someone_else" },
    });

    await ensureUserForClerkSession({ clerkUserId: "user_2abc", email: "ada@example.com" });

    expect(prisma.users.create.mock.calls[0][0].data.profile_id).toBeNull();
  });

  it("does not look up a profile when the token carries no email", async () => {
    // Clerk's default session token has no email claim; that is normal.
    await ensureUserForClerkSession({ clerkUserId: "user_2abc" });

    expect(prisma.profile.findUnique).not.toHaveBeenCalled();
    expect(prisma.users.create.mock.calls[0][0].data.email).toBeNull();
  });
});

// ── token handling ──────────────────────────────────────────────────────────

describe("extractBearerToken", () => {
  it("accepts a Bearer token, case-insensitively", () => {
    expect(extractBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(extractBearerToken("bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("rejects anything that is not a Bearer credential", () => {
    for (const header of [null, undefined, "", "   ", "abc.def.ghi", "Basic dXNlcjpwdw==", "Bearer", "Bearer   "]) {
      expect(extractBearerToken(header)).toBeNull();
    }
  });
});

describe("readEmailClaim", () => {
  it("reads whichever email claim the JWT template provided, lower-cased", () => {
    expect(readEmailClaim({ email: "Ada@Example.com" })).toBe("ada@example.com");
    expect(readEmailClaim({ primary_email_address: "ada@example.com" })).toBe("ada@example.com");
  });

  it("returns null when there is no email — the default session token has none", () => {
    for (const claims of [null, undefined, {}, { email: "" }, { email: 42 }]) {
      expect(readEmailClaim(claims as never)).toBeNull();
    }
  });
});

// ── route invariants ────────────────────────────────────────────────────────

describe("GET /me route", () => {
  const source = read("app/me/route.ts");

  it("sits outside /api, so the Supabase middleware cannot 401 a Clerk caller", () => {
    // /api/me would also have forced a PUBLIC_ROUTES entry, and that list is
    // prefix-matched — it would have exposed the existing /api/metrics.
    expect(fs.existsSync(path.join(root, "app/me/route.ts"))).toBe(true);
    expect(fs.existsSync(path.join(root, "app/api/me/route.ts"))).toBe(false);

    const middleware = read("middleware.ts");
    expect(middleware.match(/matcher:\s*"([^"]+)"/)?.[1]).toBe("/api/:path*");
    expect(middleware).not.toContain('"/api/me"');
  });

  it("verifies the session before touching the database", () => {
    expect(source.indexOf("verifyClerkSession")).toBeLessThan(
      source.indexOf("ensureUserForClerkSession("),
    );
  });

  it("answers 401 for a bad token and 500 for our own misconfiguration", () => {
    expect(source).toMatch(/Unauthenticated[\s\S]{0,40}status:\s*401/);
    expect(source).toMatch(/missing_secret[\s\S]*?status:\s*500/);
  });

  it("returns the four documented fields", () => {
    for (const field of ["userId", "role", "profile", "isActive"]) {
      expect(source).toContain(`${field}:`);
    }
  });

  it("does not log the role's value", () => {
    // Presence, not value — this log line must not become a searchable index of
    // who is an owner.
    expect(source).toMatch(/has_role: Boolean\(/);
    expect(source).not.toMatch(/role: snapshot\.role[\s\S]{0,40}logger/);
  });
});
