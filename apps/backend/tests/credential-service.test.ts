/**
 * H2, Clerk-native (ADR-204): passwords and sessions live in Clerk only.
 *
 * What this pins, against a fake Clerk Backend API:
 *   - a new password is written to Clerk (and nowhere else), with Clerk's own
 *     `signOutOfOtherSessions`;
 *   - every live Clerk session is then revoked explicitly, and the Clerk user
 *     id is deny-listed for tokens already minted;
 *   - the legacy bcrypt hash is nulled — there is no second password store;
 *   - a Clerk failure throws, so a reset that did not reset never reports
 *     success (the original H2 bug);
 *   - identity is linked by id (`externalId = profiles.id`), never by email;
 *   - nothing in the credential path touches Supabase Auth.
 *
 * PURE — `@/lib/db`, Redis and the legacy session service are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";

const { prisma, markUserSessionsRevokedAfter, legacyRevoke } = vi.hoisted(() => ({
  prisma: {
    users: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    profile: { update: vi.fn() },
  },
  markUserSessionsRevokedAfter: vi.fn(),
  legacyRevoke: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/redis/session-revocation", () => ({ markUserSessionsRevokedAfter }));
vi.mock("@/lib/services/session-lifecycle-service", () => ({
  sessionLifecycleService: { revokeSession: legacyRevoke },
}));
vi.mock("@/lib/logger", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { setClerkBackendForTests, type ClerkBackend } from "@/lib/auth/clerk-backend";
import {
  credentialService,
  SIGN_IN_TICKET_TTL_SECONDS,
} from "@/src/services/auth/credential-service";

const PROFILE_ID = "5b1d7c3e-2f4a-4c1b-9d8e-0a1b2c3d4e5f";
const CLERK_ID = "user_2abc";
const NEW_PW = "BrandNewPassword456!";

function clerkError(status: number, code: string, message = code) {
  return Object.assign(new Error(message), { status, errors: [{ code, message, longMessage: message }] });
}

function fakeClerk() {
  const calls: string[] = [];
  const fake = {
    calls,
    users: {
      createUser: vi.fn(async (_p: Record<string, unknown>) => { calls.push("createUser"); return { id: CLERK_ID }; }),
      updateUser: vi.fn(async (_id: string, _p: Record<string, unknown>) => { calls.push("updateUser"); return { id: CLERK_ID }; }),
      verifyPassword: vi.fn(async () => ({ verified: true as const })),
      getUserList: vi.fn(async () => ({ data: [] as Array<{ id: string; externalId: string | null }> })),
      deleteUser: vi.fn(async () => { calls.push("deleteUser"); return {}; }),
    },
    sessions: {
      getSessionList: vi.fn(async () => ({ data: [] as Array<{ id: string; status?: string }> })),
      revokeSession: vi.fn(async (id: string) => { calls.push(`revoke:${id}`); return {}; }),
    },
    signInTokens: {
      createSignInToken: vi.fn(async () => ({ token: "ticket_xyz" })),
    },
  };
  return fake;
}

let clerk: ReturnType<typeof fakeClerk>;
const linkedProfile = { id: PROFILE_ID, email: "ravi@gmail.com", password_hash: "$2a$10$stale" };

beforeEach(() => {
  vi.clearAllMocks();
  clerk = fakeClerk();
  setClerkBackendForTests(clerk as unknown as ClerkBackend);
  prisma.users.findUnique.mockResolvedValue(null);
  prisma.users.create.mockResolvedValue({});
  prisma.profile.update.mockResolvedValue({});
  markUserSessionsRevokedAfter.mockResolvedValue(true);
  legacyRevoke.mockResolvedValue(undefined);
});

const linkTo = (isActive = true) =>
  prisma.users.findUnique.mockResolvedValue({ clerk_user_id: CLERK_ID, is_active: isActive });

// ── password reset / change: the credential write ───────────────────────────

describe("setPassword — a profile already on Clerk", () => {
  it("writes the new password to Clerk with signOutOfOtherSessions", async () => {
    linkTo();
    await credentialService.setPassword(linkedProfile, NEW_PW);

    expect(clerk.users.updateUser).toHaveBeenCalledWith(CLERK_ID, {
      password: NEW_PW,
      signOutOfOtherSessions: true,
    });
    expect(clerk.users.createUser).not.toHaveBeenCalled();
  });

  it("then revokes every live Clerk session explicitly — active and pending, not ended ones", async () => {
    linkTo();
    clerk.sessions.getSessionList
      .mockResolvedValueOnce({ data: [
        { id: "sess_phone", status: "active" },
        { id: "sess_laptop", status: "active" },
        { id: "sess_mid_signin", status: "pending" },
        { id: "sess_old", status: "ended" },
      ] })
      .mockResolvedValue({ data: [] });

    await credentialService.setPassword(linkedProfile, NEW_PW);

    expect(clerk.sessions.getSessionList).toHaveBeenCalledWith({ userId: CLERK_ID, limit: 100 });
    const revoked = clerk.sessions.revokeSession.mock.calls.map((c: unknown[]) => c[0]);
    expect(revoked.sort()).toEqual(["sess_laptop", "sess_mid_signin", "sess_phone"]);
  });

  it("revokes only after the password is written — a session must not outlive the old password", async () => {
    linkTo();
    clerk.sessions.getSessionList.mockResolvedValueOnce({ data: [{ id: "sess_1", status: "active" }] });
    await credentialService.setPassword(linkedProfile, NEW_PW);
    expect(clerk.calls.indexOf("updateUser")).toBeLessThan(clerk.calls.indexOf("revoke:sess_1"));
  });

  it("deny-lists the Clerk user id — the `sub` middleware checks — for tokens already minted", async () => {
    linkTo();
    await credentialService.setPassword(linkedProfile, NEW_PW);
    expect(markUserSessionsRevokedAfter).toHaveBeenCalledWith(CLERK_ID);
  });

  it("nulls the legacy hash and deny-lists legacy tokens — no second password store", async () => {
    linkTo();
    await credentialService.setPassword(linkedProfile, NEW_PW);

    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { id: PROFILE_ID },
      data: { password_hash: null },
    });
    expect(legacyRevoke).toHaveBeenCalledWith(undefined, PROFILE_ID);
  });

  it("FAILS CLOSED: a Clerk outage throws, and nothing is marked done", async () => {
    linkTo();
    clerk.users.updateUser.mockRejectedValueOnce(clerkError(503, "service_unavailable"));

    await expect(credentialService.setPassword(linkedProfile, NEW_PW)).rejects.toThrow();
    expect(clerk.sessions.revokeSession).not.toHaveBeenCalled();
    expect(prisma.profile.update).not.toHaveBeenCalled();
  });

  it("turns Clerk's breached/weak-password refusal into a VALIDATION_ERROR the user can act on", async () => {
    linkTo();
    clerk.users.updateUser.mockRejectedValueOnce(
      clerkError(422, "form_password_pwned", "This password has been found in a data breach."),
    );
    await expect(credentialService.setPassword(linkedProfile, NEW_PW)).rejects.toThrow(
      /^VALIDATION_ERROR: This password has been found in a data breach\./,
    );
  });

  it("refuses a login the Clerk webhook deactivated, writing nothing", async () => {
    linkTo(false);
    await expect(credentialService.setPassword(linkedProfile, NEW_PW)).rejects.toThrow(/^FORBIDDEN/);
    expect(clerk.users.updateUser).not.toHaveBeenCalled();
  });
});

describe("setPassword — a profile not yet on Clerk", () => {
  it("creates its Clerk login with the new password, linked by externalId = profiles.id", async () => {
    await credentialService.setPassword(linkedProfile, NEW_PW);

    const params = clerk.users.createUser.mock.calls[0][0];
    expect(params).toMatchObject({ externalId: PROFILE_ID, emailAddress: ["ravi@gmail.com"], password: NEW_PW });
    // A newly chosen password gets Clerk's strength and breach checks.
    expect(params).not.toHaveProperty("skipPasswordChecks");
    expect(prisma.users.create).toHaveBeenCalledWith({
      data: { clerk_user_id: CLERK_ID, profile_id: PROFILE_ID, email: "ravi@gmail.com" },
    });
  });

  it("never sends a <phone>@hms.temp placeholder to Clerk as an email", async () => {
    await credentialService.setPassword({ id: PROFILE_ID, email: "+918008046952@hms.temp" }, NEW_PW);
    const params = clerk.users.createUser.mock.calls[0][0];
    expect(params).not.toHaveProperty("emailAddress");
    expect(prisma.users.create.mock.calls[0][0].data.email).toBeNull();
  });

  it("adopts a Clerk user an interrupted attempt left behind — and still applies the NEW password", async () => {
    clerk.users.getUserList.mockResolvedValueOnce({ data: [{ id: CLERK_ID, externalId: PROFILE_ID }] });

    await credentialService.setPassword(linkedProfile, NEW_PW);

    expect(clerk.users.createUser).not.toHaveBeenCalled();
    expect(clerk.users.updateUser).toHaveBeenCalledWith(CLERK_ID, { password: NEW_PW });
  });

  it("still revokes and retires legacy credentials, so an old Supabase session is cut off", async () => {
    await credentialService.setPassword(linkedProfile, NEW_PW);
    expect(markUserSessionsRevokedAfter).toHaveBeenCalledWith(CLERK_ID);
    expect(prisma.profile.update).toHaveBeenCalledWith({ where: { id: PROFILE_ID }, data: { password_hash: null } });
  });
});

// ── checking a password ─────────────────────────────────────────────────────

describe("verifyPassword", () => {
  it("asks Clerk for a profile on Clerk, and never falls back to a stale hash", async () => {
    linkTo();
    const hash = await bcrypt.hash("OldPassword1", 4);
    clerk.users.verifyPassword.mockRejectedValueOnce(clerkError(422, "incorrect_password"));

    // The stale hash would have said yes. Clerk says no, and Clerk wins.
    const result = await credentialService.verifyPassword({ ...linkedProfile, password_hash: hash }, "OldPassword1");
    expect(result).toEqual({ ok: false, via: "clerk" });
    expect(clerk.users.verifyPassword).toHaveBeenCalledWith({ userId: CLERK_ID, password: "OldPassword1" });
  });

  it("says yes when Clerk says yes", async () => {
    linkTo();
    expect(await credentialService.verifyPassword(linkedProfile, NEW_PW)).toEqual({ ok: true, via: "clerk" });
  });

  it("throws on a Clerk outage rather than calling a right password wrong", async () => {
    linkTo();
    clerk.users.verifyPassword.mockRejectedValueOnce(clerkError(500, "internal"));
    await expect(credentialService.verifyPassword(linkedProfile, NEW_PW)).rejects.toThrow();
  });

  it("uses the legacy hash only for a profile not yet on Clerk", async () => {
    const hash = await bcrypt.hash("OldPassword1", 4);
    const result = await credentialService.verifyPassword({ ...linkedProfile, password_hash: hash }, "OldPassword1");
    expect(result).toEqual({ ok: true, via: "legacy_hash" });
    expect(clerk.users.verifyPassword).not.toHaveBeenCalled();
  });
});

describe("migrateOnSignIn", () => {
  it("carries the just-proved password across with Clerk's checks skipped, then nulls the hash", async () => {
    await credentialService.migrateOnSignIn(linkedProfile, "OldPassword1");

    expect(clerk.users.createUser.mock.calls[0][0]).toMatchObject({
      externalId: PROFILE_ID,
      password: "OldPassword1",
      skipPasswordChecks: true,
    });
    expect(prisma.profile.update).toHaveBeenCalledWith({ where: { id: PROFILE_ID }, data: { password_hash: null } });
  });
});

// ── sessions ────────────────────────────────────────────────────────────────

describe("revokeAllSessions", () => {
  it("re-lists until no live session remains, since revoking shrinks the list", async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ id: `sess_${i}`, status: "active" }));
    clerk.sessions.getSessionList
      .mockResolvedValueOnce({ data: page })
      .mockResolvedValueOnce({ data: [{ id: "sess_100", status: "active" }] })
      .mockResolvedValue({ data: [] });

    expect(await credentialService.revokeAllSessions(CLERK_ID)).toBe(101);
  });

  it("is bounded even if Clerk keeps reporting a session as live", async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, status: "active" }));
    clerk.sessions.getSessionList.mockResolvedValue({ data: page });
    await credentialService.revokeAllSessions(CLERK_ID);
    expect(clerk.sessions.getSessionList.mock.calls.length).toBeLessThanOrEqual(10);
  });
});

describe("issueSignInTicket", () => {
  it("mints a short-lived single-use ticket for exactly this Clerk user", async () => {
    expect(await credentialService.issueSignInTicket(CLERK_ID)).toBe("ticket_xyz");
    expect(clerk.signInTokens.createSignInToken).toHaveBeenCalledWith({
      userId: CLERK_ID,
      expiresInSeconds: SIGN_IN_TICKET_TTL_SECONDS,
    });
    expect(SIGN_IN_TICKET_TTL_SECONDS).toBeLessThanOrEqual(300);
  });
});

describe("closeLogin (account closure)", () => {
  it("revokes every session, deletes the Clerk user, and deactivates — never deletes — our row", async () => {
    linkTo();
    clerk.sessions.getSessionList.mockResolvedValueOnce({ data: [{ id: "sess_1", status: "active" }] });

    await credentialService.closeLogin(PROFILE_ID);

    expect(clerk.calls).toEqual(["revoke:sess_1", "deleteUser"]);
    expect(prisma.users.update).toHaveBeenCalledWith({
      where: { clerk_user_id: CLERK_ID },
      data: expect.objectContaining({ is_active: false, deactivated_at: expect.any(Date) }),
    });
  });

  it("is a no-op for a profile that never had a Clerk login", async () => {
    await credentialService.closeLogin(PROFILE_ID);
    expect(clerk.users.deleteUser).not.toHaveBeenCalled();
  });
});

// ── the architectural rule, as a source guard ───────────────────────────────

describe("Clerk is the only authentication provider; Supabase is only a database", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

  const FORBIDDEN = [/supabase\.auth/, /supabaseAdmin\.auth/, /updateUserById/, /auth\.sessions/, /auth\.refresh_tokens/, /auth\.users/];

  it.each([
    "src/services/auth/credential-service.ts",
    "lib/auth/clerk-backend.ts",
    "lib/auth/clerk-session-resolver.ts",
    "lib/auth/clerk-jwt-edge.ts",
  ])("%s never touches Supabase Auth", (file) => {
    const src = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const pattern of FORBIDDEN) expect(src).not.toMatch(pattern);
  });

  it("the password-reset, change and onboarding flows write only through Clerk", () => {
    const src = read("lib/services/auth-service.ts");
    const method = (name: string) => {
      const start = src.indexOf(`  async ${name}(`);
      return src.slice(start, src.indexOf("\n  async ", start + 10));
    };
    for (const name of ["completePasswordReset", "resetOnboardingPassword", "changePassword"]) {
      const body = method(name);
      expect(body).toContain("credentialService.setPassword(");
      for (const pattern of FORBIDDEN) expect(body).not.toMatch(pattern);
      expect(body).not.toMatch(/ensureSupabaseIdentity|hashPassword/);
    }
  });

  it("no code path writes a non-null password_hash any more", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(rel); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const src = read(rel);
        const re = /\bpassword_hash\s*:\s*([^,\n}]+)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) {
          const value = m[1].trim();
          if (!/^(null|true|false|string|undefined)\b/.test(value) && !/String\?/.test(value)) offenders.push(`${rel}: ${m[0]}`);
        }
      }
    };
    ["app", "lib", "src"].forEach(walk);
    expect(offenders).toEqual([]);
  });

  it("lib/auth no longer exports password hashing", () => {
    expect(read("lib/auth.ts")).not.toMatch(/export async function (hashPassword|verifyPassword)/);
  });
});
