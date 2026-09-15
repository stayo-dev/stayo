/**
 * `resolveSupabaseSession()` never attaches a Supabase identity to a profile
 * by email match (C1, 2026-09-14 security audit).
 *
 * It used to: a Supabase JWT whose `sub` matched no profile fell back to
 * `profiles.email`, then overwrote that profile's `auth_user_id` with the
 * caller's — even when the profile was already linked to someone else. Anyone
 * who could get a Supabase session for an email (a self-signup with the public
 * anon key, or an email they had just written onto a victim's profile) became
 * that profile on every route.
 *
 * The only legitimate ways a profile gains a Supabase identity are the
 * backend-mediated ones that prove the password first
 * (`ensureSupabaseIdentity`, signups that are born linked). A token that is
 * not already linked is refused.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, eventLog, getActiveTenancy } = vi.hoisted(() => ({
  prisma: { profile: { findUnique: vi.fn(), update: vi.fn() } },
  eventLog: { log: vi.fn() },
  getActiveTenancy: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog }));
vi.mock("@/lib/tenancy/active-tenancy", () => ({ getActiveTenancy }));

import { resolveSupabaseSession } from "../lib/auth/supabase-session";

const VICTIM_PROFILE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VICTIM_AUTH_USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ATTACKER_AUTH_USER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const profile = (overrides: Record<string, unknown> = {}) => ({
  id: VICTIM_PROFILE,
  email: "victim@stayo.test",
  role: "OWNER",
  owner_id: VICTIM_PROFILE,
  is_active: true,
  auth_user_id: VICTIM_AUTH_USER,
  ...overrides,
});

const ctx = (authUserId: string, overrides: Record<string, unknown> = {}) => ({
  authUserId,
  email: "victim@stayo.test",
  emailVerified: true,
  sessionId: "session-1",
  provider: "email",
  ...overrides,
});

/** `findUnique` answers by whichever key it is asked about. */
function profilesIndexedBy(rows: ReturnType<typeof profile>[]) {
  prisma.profile.findUnique.mockImplementation(async ({ where }: any) => {
    if (where.auth_user_id) return rows.find((r) => r.auth_user_id === where.auth_user_id) ?? null;
    if (where.email) return rows.find((r) => r.email === where.email) ?? null;
    if (where.id) return rows.find((r) => r.id === where.id) ?? null;
    return null;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getActiveTenancy.mockResolvedValue(null);
});

describe("a token already linked to a profile", () => {
  it("resolves to that profile", async () => {
    profilesIndexedBy([profile()]);
    const result = await resolveSupabaseSession(ctx(VICTIM_AUTH_USER));
    expect(result).toEqual({
      ok: true,
      payload: expect.objectContaining({ sub: VICTIM_PROFILE, role: "OWNER", owner_id: VICTIM_PROFILE, sid: "session-1" }),
    });
  });

  it("is refused when the profile is deactivated", async () => {
    profilesIndexedBy([profile({ is_active: false })]);
    const result = await resolveSupabaseSession(ctx(VICTIM_AUTH_USER));
    expect(result).toMatchObject({ ok: false, code: "ACCOUNT_DISABLED" });
  });

  it("is refused for a tenant whose tenancy is not activated yet", async () => {
    profilesIndexedBy([profile({ role: "TENANT", owner_id: "owner-x" })]);
    getActiveTenancy.mockResolvedValue({ id: "tenancy-1", status: "INVITED" });
    const result = await resolveSupabaseSession(ctx(VICTIM_AUTH_USER));
    expect(result).toMatchObject({ ok: false, code: "TENANCY_NOT_ACTIVATED" });
  });
});

describe("a token that is not linked to any profile", () => {
  it("cannot take over a profile that shares its email", async () => {
    profilesIndexedBy([profile()]);
    const result = await resolveSupabaseSession(ctx(ATTACKER_AUTH_USER));
    expect(result).toMatchObject({ ok: false, code: "NO_STAYO_ACCOUNT" });
    expect(prisma.profile.update).not.toHaveBeenCalled();
  });

  it("is not linked to an unlinked profile by email either", async () => {
    profilesIndexedBy([profile({ auth_user_id: null })]);
    const result = await resolveSupabaseSession(ctx(ATTACKER_AUTH_USER));
    expect(result).toMatchObject({ ok: false, code: "NO_STAYO_ACCOUNT" });
    expect(prisma.profile.update).not.toHaveBeenCalled();
  });

  it("is refused when no profile has its email", async () => {
    profilesIndexedBy([]);
    const result = await resolveSupabaseSession(ctx(ATTACKER_AUTH_USER, { email: "nobody@stayo.test" }));
    expect(result).toMatchObject({ ok: false, code: "NO_STAYO_ACCOUNT" });
    expect(prisma.profile.update).not.toHaveBeenCalled();
  });

  it("records the refusal", async () => {
    profilesIndexedBy([profile()]);
    await resolveSupabaseSession(ctx(ATTACKER_AUTH_USER));
    expect(eventLog.log).toHaveBeenCalledWith(
      "AUTH_SUPABASE_UNLINKED_REJECTED",
      null,
      expect.objectContaining({ auth_user_id: ATTACKER_AUTH_USER, email: "victim@stayo.test" }),
    );
  });
});
