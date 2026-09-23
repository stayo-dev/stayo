/**
 * Discover's Google-signup provisioning (2026-09-23) — the one deliberate,
 * narrow exception to ADR-176 Phase 3.1's "authentication never creates a
 * Stayo account". See `lib/auth/discover-google-provisioning.ts`'s header for
 * the full reasoning; these tests are the mechanical proof of its bounds:
 *   - a Clerk identity already linked, disabled, or tenancy-gated is
 *     untouched — `resolveClerkSession`'s own answer is returned as-is;
 *   - a genuinely new identity gets the same self-serve marketplace seeker
 *     `authService.selfSignUpTenant()` already creates with a password;
 *   - never by email — an existing profile with the same address blocks
 *     provisioning rather than being adopted;
 *   - idempotent and race-safe under concurrent calls for the same identity.
 *
 * PURE — `@/lib/db` and `@/lib/auth/clerk-backend` are mocked. Qualifies for
 * vitest.pure.config.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  prisma: {
    users: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    profile: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), update: vi.fn() },
  },
  getActiveTenancy: vi.fn(),
  clerkUsersGetUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/tenancy/active-tenancy", () => ({ getActiveTenancy: m.getActiveTenancy }));
vi.mock("@/lib/logger", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), metrics: vi.fn() }),
}));
vi.mock("@/lib/auth/clerk-backend", () => ({
  getClerkBackend: () => ({ users: { getUser: m.clerkUsersGetUser } }),
}));

import { provisionDiscoverSeekerFromClerk } from "@/lib/auth/discover-google-provisioning";

const CLERK_USER_ID = "user_2abcNewGoogle";
const EMAIL = "riya.new@gmail.com";

function p2002() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

function clerkUser(overrides: Partial<{ email: string; verified: boolean }> = {}) {
  const email = overrides.email ?? EMAIL;
  const verified = overrides.verified ?? true;
  return {
    id: CLERK_USER_ID,
    primaryEmailAddressId: "idn_1",
    emailAddresses: [
      { id: "idn_1", emailAddress: email, verification: verified ? { status: "verified" } : { status: "unverified" } },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getActiveTenancy.mockResolvedValue(null);
});

describe("provisionDiscoverSeekerFromClerk — already resolved", () => {
  it("case 1: an existing Google-linked Stayo user is returned as-is, nothing created", async () => {
    m.prisma.users.findUnique.mockResolvedValue({ is_active: true, profile_id: "existing-profile" });
    m.prisma.profile.findUnique.mockResolvedValue({
      id: "existing-profile",
      email: EMAIL,
      role: "TENANT",
      owner_id: null,
      is_active: true,
    });

    const result = await provisionDiscoverSeekerFromClerk(CLERK_USER_ID);

    expect(result).toEqual({
      ok: true,
      payload: expect.objectContaining({ sub: "existing-profile", role: "TENANT" }),
    });
    expect(m.prisma.profile.create).not.toHaveBeenCalled();
    expect(m.clerkUsersGetUser).not.toHaveBeenCalled();
  });

  it("case 11: an existing owner/invited account's rejection (ACCOUNT_DISABLED) is returned untouched, never overridden by provisioning", async () => {
    m.prisma.users.findUnique.mockResolvedValue({ is_active: false, profile_id: "disabled-profile" });

    const result = await provisionDiscoverSeekerFromClerk(CLERK_USER_ID);

    expect(result).toEqual({ ok: false, code: "ACCOUNT_DISABLED", message: expect.any(String) });
    expect(m.prisma.profile.create).not.toHaveBeenCalled();
    expect(m.clerkUsersGetUser).not.toHaveBeenCalled();
  });

  it("case 11b: TENANCY_NOT_ACTIVATED is likewise returned untouched", async () => {
    m.prisma.users.findUnique.mockResolvedValue({ is_active: true, profile_id: "invited-profile" });
    m.prisma.profile.findUnique.mockResolvedValue({
      id: "invited-profile",
      email: EMAIL,
      role: "TENANT",
      owner_id: null,
      is_active: true,
    });
    m.getActiveTenancy.mockResolvedValue({ id: "t1", status: "INVITED" });

    const result = await provisionDiscoverSeekerFromClerk(CLERK_USER_ID);

    expect(result).toEqual({ ok: false, code: "TENANCY_NOT_ACTIVATED", message: expect.any(String) });
    expect(m.prisma.profile.create).not.toHaveBeenCalled();
  });
});

describe("provisionDiscoverSeekerFromClerk — new identity", () => {
  let linkState: { linkedProfileId: string | null };
  let createdProfileId: string | undefined;

  beforeEach(() => {
    createdProfileId = undefined;
    // These mocks are a stand-in for a real database across an ENTIRE
    // provisioning run, which reads `users`/`profile` more than once at
    // different points (initial resolveClerkSession, then again after
    // linking) — so behaviour has to follow call order, not a single fixed
    // return value. `linkState` is the shared "what would the table say
    // right now" the mock implementations below consult.
    linkState = { linkedProfileId: null };
    m.clerkUsersGetUser.mockResolvedValue(clerkUser());
    m.prisma.users.findUnique.mockImplementation(async () =>
      linkState.linkedProfileId ? { is_active: true, profile_id: linkState.linkedProfileId } : null,
    );
    m.prisma.profile.findUnique.mockImplementation(async ({ where }: any) => {
      // The email-collision check (must find nothing new). The re-resolve
      // at the end reads back the row that was actually created/linked.
      if (where.email) return null;
      if (where.id === linkState.linkedProfileId) {
        return { id: where.id, email: EMAIL, name: EMAIL.split("@")[0], role: "TENANT", owner_id: null, is_active: true };
      }
      return null;
    });
    m.prisma.profile.create.mockImplementation(async ({ data }: any) => {
      createdProfileId = data.id;
      return {};
    });
    m.prisma.profile.delete.mockResolvedValue({});
    m.prisma.users.updateMany.mockImplementation(async ({ data }: any) => {
      linkState.linkedProfileId = data.profile_id;
      return { count: 1 };
    });
  });

  it("case 2+3: creates a TENANT profile shaped like selfSignUpTenant()'s — no owner, no password, phone null", async () => {
    await provisionDiscoverSeekerFromClerk(CLERK_USER_ID);

    expect(m.prisma.profile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: EMAIL,
        role: "TENANT",
        is_active: true,
        phone: null,
        phone_verified: false,
        mobile_verified: false,
        is_profile_completed: true,
      }),
    });
    const created = m.prisma.profile.create.mock.calls[0][0].data;
    expect(created).not.toHaveProperty("owner_id");
    expect(created).not.toHaveProperty("password_hash");
  });

  it("case 4: links the Clerk identity by id — clerk_user_id → the new profile", async () => {
    await provisionDiscoverSeekerFromClerk(CLERK_USER_ID);

    expect(m.prisma.users.updateMany).toHaveBeenCalledWith({
      where: { clerk_user_id: CLERK_USER_ID, profile_id: null },
      data: { profile_id: expect.any(String) },
    });
  });

  it("case 5+6: the returned result is exactly what resolveClerkSession (and so /auth/me and requireSeeker) would produce for the now-linked account", async () => {
    const result = await provisionDiscoverSeekerFromClerk(CLERK_USER_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.role).toBe("TENANT");
      expect(result.payload.tenant_id).toBeNull();
    }
  });

  it("no `users` row exists yet (webhook hasn't landed): creates one directly, linked from the start", async () => {
    m.prisma.users.updateMany.mockResolvedValue({ count: 0 });
    m.prisma.users.create.mockImplementation(async ({ data }: any) => {
      linkState.linkedProfileId = data.profile_id;
      return {};
    });

    await provisionDiscoverSeekerFromClerk(CLERK_USER_ID);

    expect(m.prisma.users.create).toHaveBeenCalledWith({
      data: { clerk_user_id: CLERK_USER_ID, profile_id: expect.any(String), email: EMAIL },
    });
  });

  it("case 8: repeated provisioning for an already-linked identity is a no-op the second time", async () => {
    await provisionDiscoverSeekerFromClerk(CLERK_USER_ID);
    expect(linkState.linkedProfileId).toBeTruthy();

    // A real second call for the same, now-linked identity: linkState
    // already reflects it, so resolveClerkSession's first check succeeds
    // immediately — nothing below "no-op" runs.
    m.prisma.profile.create.mockClear();

    const second = await provisionDiscoverSeekerFromClerk(CLERK_USER_ID);

    expect(second.ok).toBe(true);
    expect(m.prisma.profile.create).not.toHaveBeenCalled();
  });

  it("case 9: a concurrent winner (P2002 on users.create) is adopted — the loser's own profile is deleted, not left as a duplicate", async () => {
    const winnerProfileId = "winner-profile-id";
    m.prisma.users.updateMany.mockResolvedValue({ count: 0 });
    m.prisma.users.create.mockRejectedValue(p2002());
    // First call (the initial resolveClerkSession check, before this
    // function has done anything): still unlinked — that's what makes
    // provisioning eligible at all. Only the reconciliation read *after* the
    // P2002 discovers the concurrent winner, exactly as a real race would.
    let findUniqueCalls = 0;
    m.prisma.users.findUnique.mockImplementation(async () => {
      findUniqueCalls += 1;
      return findUniqueCalls === 1 ? null : { is_active: true, profile_id: winnerProfileId };
    });
    m.prisma.profile.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.email) return null;
      if (where.id === winnerProfileId) return { id: winnerProfileId, email: EMAIL, role: "TENANT", owner_id: null, is_active: true };
      return null;
    });

    const result = await provisionDiscoverSeekerFromClerk(CLERK_USER_ID);

    expect(m.prisma.profile.delete).toHaveBeenCalledTimes(1);
    const deletedId = m.prisma.profile.delete.mock.calls[0][0].where.id;
    expect(deletedId).toBe(createdProfileId); // deletes the loser's own profile, not the winner's
    expect(deletedId).not.toBe(winnerProfileId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.sub).toBe(winnerProfileId);
  });

  it("never matches an unrelated existing profile by email — refuses instead of adopting it", async () => {
    m.prisma.profile.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.email) return { id: "someone-elses-profile" };
      return null;
    });

    const result = await provisionDiscoverSeekerFromClerk(CLERK_USER_ID);

    expect(result).toEqual({ ok: false, code: "NO_STAYO_ACCOUNT", message: expect.any(String) });
    expect(m.prisma.profile.create).not.toHaveBeenCalled();
    expect(m.prisma.users.updateMany).not.toHaveBeenCalled();
  });

  it("refuses cleanly when Clerk gives no verified email — no partial account left behind", async () => {
    m.clerkUsersGetUser.mockResolvedValue(clerkUser({ verified: false }));

    const result = await provisionDiscoverSeekerFromClerk(CLERK_USER_ID);

    expect(result.ok).toBe(false);
    expect(m.prisma.profile.create).not.toHaveBeenCalled();
  });

  it("rolls back the profile it created if linking fails irrecoverably — never a partially linked account", async () => {
    m.prisma.users.updateMany.mockRejectedValue(new Error("connection reset"));

    const result = await provisionDiscoverSeekerFromClerk(CLERK_USER_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NO_STAYO_ACCOUNT");
    expect(m.prisma.profile.delete).toHaveBeenCalledTimes(1);
  });
});
