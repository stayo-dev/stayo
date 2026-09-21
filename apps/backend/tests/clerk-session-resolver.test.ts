/**
 * The session model (ADR-204):
 *   1. Clerk issues the session.
 *   2. The backend verifies the Clerk token (middleware, clerk-jwt-edge).
 *   3. The profile is resolved by the immutable Clerk user id — never by email.
 *   4. Roles stay in our database.
 * Plus the transition rule: a Supabase or legacy token is refused for any
 * profile that has moved onto Clerk, which is how a Clerk-side reset ends a
 * pre-Clerk session without a single Supabase call.
 *
 * PURE — `@/lib/db` and the tenancy lookup are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  prisma: {
    users: { findUnique: vi.fn() },
    profile: { findUnique: vi.fn(), update: vi.fn() },
  },
  getActiveTenancy: vi.fn(),
  resolveSupabaseSession: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/tenancy/active-tenancy", () => ({ getActiveTenancy: m.getActiveTenancy }));
vi.mock("@/lib/auth/supabase-session", () => ({ resolveSupabaseSession: m.resolveSupabaseSession }));

import { resolveClerkSession } from "@/lib/auth/clerk-session-resolver";
import { getSession } from "@/lib/auth";
import { parseAuthorizedParties, peekIssuer, toClerkClaims } from "@/lib/auth/clerk-jwt-edge";
import { parseAcceptsClerkTicket } from "@/lib/auth/session-capabilities";

const PROFILE_ID = "5b1d7c3e-2f4a-4c1b-9d8e-0a1b2c3d4e5f";
const owner = { id: PROFILE_ID, email: "ravi@gmail.com", role: "OWNER", owner_id: PROFILE_ID, is_active: true };

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.users.findUnique.mockResolvedValue({ is_active: true, profile_id: PROFILE_ID });
  m.prisma.profile.findUnique.mockResolvedValue(owner);
  m.getActiveTenancy.mockResolvedValue(null);
});

describe("resolveClerkSession — id → id → id", () => {
  it("resolves the Clerk user id to its linked profile, with the role from our database", async () => {
    const result = await resolveClerkSession({ clerkUserId: "user_2abc", sessionId: "sess_1" });

    expect(m.prisma.users.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clerk_user_id: "user_2abc" } }),
    );
    expect(m.prisma.profile.findUnique).toHaveBeenCalledWith({ where: { id: PROFILE_ID } });
    expect(result).toEqual({
      ok: true,
      payload: { sub: PROFILE_ID, role: "OWNER", email: "ravi@gmail.com", owner_id: PROFILE_ID, tenant_id: null, sid: "sess_1" },
    });
  });

  it("never looks a profile up by email — an unlinked login is not an account", async () => {
    m.prisma.users.findUnique.mockResolvedValue({ is_active: true, profile_id: null });

    const result = await resolveClerkSession({ clerkUserId: "user_2abc", sessionId: "sess_1" });

    expect(result).toMatchObject({ ok: false, code: "NO_STAYO_ACCOUNT" });
    expect(m.prisma.profile.findUnique).not.toHaveBeenCalled();
  });

  it("refuses a Clerk user we have never seen", async () => {
    m.prisma.users.findUnique.mockResolvedValue(null);
    expect(await resolveClerkSession({ clerkUserId: "user_x", sessionId: "s" })).toMatchObject({ code: "NO_STAYO_ACCOUNT" });
  });

  it("refuses a login the webhook deactivated, and a disabled profile", async () => {
    m.prisma.users.findUnique.mockResolvedValueOnce({ is_active: false, profile_id: PROFILE_ID });
    expect(await resolveClerkSession({ clerkUserId: "u", sessionId: "s" })).toMatchObject({ code: "ACCOUNT_DISABLED" });

    m.prisma.profile.findUnique.mockResolvedValueOnce({ ...owner, is_active: false });
    expect(await resolveClerkSession({ clerkUserId: "u", sessionId: "s" })).toMatchObject({ code: "ACCOUNT_DISABLED" });
  });

  it("holds the activation gate: an invited tenant cannot reach a dashboard by any sign-in", async () => {
    m.prisma.profile.findUnique.mockResolvedValue({ ...owner, role: "TENANT", owner_id: "someone" });
    m.getActiveTenancy.mockResolvedValue({ id: "t1", status: "INVITED" });
    expect(await resolveClerkSession({ clerkUserId: "u", sessionId: "s" })).toMatchObject({ code: "TENANCY_NOT_ACTIVATED" });
  });
});

function request(headers: Record<string, string>) {
  return { headers: new Headers(headers) } as any;
}

describe("getSession", () => {
  it("resolves x-auth-mode: clerk through the id-only resolver", async () => {
    const session = await getSession(
      request({ "x-auth-mode": "clerk", "x-auth-user-id": "user_2abc", "x-auth-session-id": "sess_1" }),
    );
    expect(session).toMatchObject({ sub: PROFILE_ID, role: "OWNER", sid: "sess_1" });
  });

  it("refuses a legacy token for a profile that has moved onto Clerk", async () => {
    m.prisma.users.findUnique.mockResolvedValue({ clerk_user_id: "user_2abc" });
    const session = await getSession(
      request({ "x-auth-mode": "legacy", "x-user-id": PROFILE_ID, "x-user-role": "OWNER" }),
    );
    expect(session).toBeNull();
  });

  it("refuses a Supabase token for a profile that has moved onto Clerk — the reset cut-off", async () => {
    m.resolveSupabaseSession.mockResolvedValue({ ok: true, payload: { sub: PROFILE_ID, role: "OWNER" } });
    m.prisma.users.findUnique.mockResolvedValue({ clerk_user_id: "user_2abc" });

    const session = await getSession(request({ "x-auth-mode": "supabase", "x-auth-user-id": "sb-uuid" }));

    expect(session).toBeNull();
  });

  it("still honours a Supabase token for a profile that has NOT moved (transition only)", async () => {
    m.resolveSupabaseSession.mockResolvedValue({ ok: true, payload: { sub: PROFILE_ID, role: "OWNER" } });
    m.prisma.users.findUnique.mockResolvedValue(null);

    const session = await getSession(request({ "x-auth-mode": "supabase", "x-auth-user-id": "sb-uuid" }));

    expect(session).toMatchObject({ sub: PROFILE_ID });
  });
});

describe("edge helpers", () => {
  it("toClerkClaims requires both a user and a session id", () => {
    expect(toClerkClaims({ sub: "user_1", sid: "sess_1", iat: 10 })).toEqual({ sub: "user_1", sid: "sess_1", iat: 10 });
    expect(toClerkClaims({ sub: "user_1" })).toBeNull();
    expect(toClerkClaims({ sid: "sess_1" })).toBeNull();
    expect(toClerkClaims(null)).toBeNull();
  });

  it("parseAuthorizedParties trims, drops trailing slashes, and treats blank as unpinned", () => {
    expect(parseAuthorizedParties("https://yourstayo.com/, https://www.yourstayo.com")).toEqual([
      "https://yourstayo.com",
      "https://www.yourstayo.com",
    ]);
    expect(parseAuthorizedParties("")).toBeUndefined();
    expect(parseAuthorizedParties(undefined)).toBeUndefined();
  });

  it("peekIssuer reads iss without verifying, and survives garbage", () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    expect(peekIssuer(`${b64({ alg: "RS256" })}.${b64({ iss: "https://clerk.yourstayo.com" })}.sig`)).toBe(
      "https://clerk.yourstayo.com",
    );
    expect(peekIssuer("not-a-jwt")).toBeNull();
    expect(peekIssuer("a.%%%.c")).toBeNull();
  });

  it("parseAcceptsClerkTicket matches the capability exactly", () => {
    expect(parseAcceptsClerkTicket("clerk-ticket")).toBe(true);
    expect(parseAcceptsClerkTicket("foo, Clerk-Ticket")).toBe(true);
    expect(parseAcceptsClerkTicket("clerk-tickets")).toBe(false);
    expect(parseAcceptsClerkTicket(null)).toBe(false);
  });
});
