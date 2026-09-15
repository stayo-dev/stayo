/**
 * The password flows in `authService`, on Clerk (ADR-204, Clerk-native H2).
 *
 *   - reset (email link / WhatsApp code), change and the onboarding first
 *     password all hand the new password to `credentialService.setPassword`
 *     — the one place that writes Clerk and revokes every session — and a
 *     Clerk failure propagates instead of being logged and swallowed;
 *   - change password checks the current password through Clerk first;
 *   - a sign-in ends in a Clerk ticket, moving a not-yet-migrated profile
 *     onto Clerk with the password it just proved; the Supabase session is
 *     minted only for a pre-Clerk browser AND a profile that has not moved.
 *
 * PURE — every I/O module is mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  prisma: {
    profile: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), delete: vi.fn() },
    tenants: { findFirst: vi.fn() },
  },
  credentialService: {
    findLogin: vi.fn(),
    verifyPassword: vi.fn(),
    setPassword: vi.fn(),
    ensureLogin: vi.fn(),
    migrateOnSignIn: vi.fn(),
    issueSignInTicket: vi.fn(),
  },
  verifyResetToken: vi.fn(),
  setOneTimeLock: vi.fn(),
  ensureSupabaseIdentity: vi.fn(),
  signInWithSupabasePassword: vi.fn(),
  eventLog: { log: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/auth", () => ({ verifyResetToken: m.verifyResetToken, generateResetToken: vi.fn() }));
vi.mock("@/src/services/auth/credential-service", () => ({ credentialService: m.credentialService }));
vi.mock("@/lib/auth/supabase-identity", () => ({
  ensureSupabaseIdentity: m.ensureSupabaseIdentity,
  signInWithSupabasePassword: m.signInWithSupabasePassword,
}));
vi.mock("@/lib/redis/rate-limit", () => ({ setOneTimeLock: m.setOneTimeLock }));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: m.eventLog }));
vi.mock("@/lib/services/email-service", () => ({ EmailService: { sendEmail: vi.fn() }, getEffectiveEmailFrom: vi.fn() }));
vi.mock("@/lib/services/auth/auth-otp-service", () => ({ authOtpService: {}, profilePhoneCandidates: (p: string) => [p] }));
vi.mock("@/lib/tenancy/active-tenancy", () => ({ liveTenancyWhere: (id: string) => ({ profile_id: id }) }));

import { authService } from "@/lib/services/auth-service";

const PROFILE = {
  id: "5b1d7c3e-2f4a-4c1b-9d8e-0a1b2c3d4e5f",
  email: "ravi@gmail.com",
  role: "OWNER",
  owner_id: "5b1d7c3e-2f4a-4c1b-9d8e-0a1b2c3d4e5f",
  is_active: true,
  password_hash: null,
  name: "Ravi",
  password_reset_required: false,
  is_profile_completed: true,
};
const NEW_PW = "BrandNewPassword456!";

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.profile.findUnique.mockResolvedValue(PROFILE);
  m.prisma.profile.update.mockResolvedValue(PROFILE);
  m.verifyResetToken.mockResolvedValue({ email: PROFILE.email, channel: "email" });
  m.setOneTimeLock.mockResolvedValue(true);
  m.credentialService.setPassword.mockResolvedValue({ clerkUserId: "user_2abc" });
  m.credentialService.verifyPassword.mockResolvedValue({ ok: true, via: "clerk" });
  m.credentialService.findLogin.mockResolvedValue({ clerkUserId: "user_2abc", isActive: true });
  m.credentialService.issueSignInTicket.mockResolvedValue("ticket_xyz");
  m.eventLog.log.mockResolvedValue(undefined);
});

describe("password reset (H2)", () => {
  it("writes the new password through Clerk and only then clears the reset flags", async () => {
    await authService.completePasswordReset({ accessToken: "tok", newPassword: NEW_PW });

    expect(m.credentialService.setPassword).toHaveBeenCalledWith(
      expect.objectContaining({ id: PROFILE.id, email: PROFILE.email }),
      NEW_PW,
    );
    const setAt = m.credentialService.setPassword.mock.invocationCallOrder[0];
    const flagsAt = m.prisma.profile.update.mock.invocationCallOrder[0];
    expect(setAt).toBeLessThan(flagsAt);
    expect(m.prisma.profile.update.mock.calls[0][0].data).toEqual({
      password_reset_required: false,
      password_reset_at: expect.any(Date),
    });
  });

  it("does NOT report success when Clerk refuses — the bug H2 was", async () => {
    m.credentialService.setPassword.mockRejectedValueOnce(new Error("Clerk unavailable"));
    await expect(authService.completePasswordReset({ accessToken: "tok", newPassword: NEW_PW })).rejects.toThrow(
      "Clerk unavailable",
    );
    expect(m.prisma.profile.update).not.toHaveBeenCalled();
    expect(m.eventLog.log).not.toHaveBeenCalledWith("PASSWORD_RESET_COMPLETED", expect.anything(), expect.anything());
  });

  it("never touches Supabase", async () => {
    await authService.completePasswordReset({ accessToken: "tok", newPassword: NEW_PW });
    expect(m.ensureSupabaseIdentity).not.toHaveBeenCalled();
    expect(m.signInWithSupabasePassword).not.toHaveBeenCalled();
  });

  it("still refuses a reused link before any credential write", async () => {
    m.setOneTimeLock.mockResolvedValueOnce(false);
    await expect(authService.completePasswordReset({ accessToken: "tok", newPassword: NEW_PW })).rejects.toThrow(
      /already been used/,
    );
    expect(m.credentialService.setPassword).not.toHaveBeenCalled();
  });
});

describe("change password", () => {
  it("checks the current password through the credential service, then sets and revokes everything", async () => {
    const result = await authService.changePassword(PROFILE.id, "OldPassword1", NEW_PW);

    expect(m.credentialService.verifyPassword).toHaveBeenCalledWith(expect.objectContaining({ id: PROFILE.id }), "OldPassword1");
    expect(m.credentialService.setPassword).toHaveBeenCalledWith(expect.objectContaining({ id: PROFILE.id }), NEW_PW);
    // Every session is revoked — this device's too — so the client must re-auth.
    expect(result).toMatchObject({ success: true, reauth_required: true });
  });

  it("refuses a wrong current password and writes nothing", async () => {
    m.credentialService.verifyPassword.mockResolvedValueOnce({ ok: false, via: "clerk" });
    await expect(authService.changePassword(PROFILE.id, "wrong", NEW_PW)).rejects.toThrow(/^UNAUTHORIZED/);
    expect(m.credentialService.setPassword).not.toHaveBeenCalled();
  });
});

describe("onboarding first password", () => {
  it("sets the chosen password through Clerk and clears the onboarding flags", async () => {
    m.prisma.profile.findFirst.mockResolvedValue({ ...PROFILE, role: "TENANT", password_reset_required: true });

    await authService.resetOnboardingPassword("+919876543210", "TempPass1", "NewPassword9");

    expect(m.credentialService.verifyPassword).toHaveBeenCalledWith(expect.anything(), "TempPass1");
    expect(m.credentialService.setPassword).toHaveBeenCalledWith(expect.anything(), "NewPassword9");
    const data = m.prisma.profile.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("password_hash");
    expect(data).toMatchObject({ password_reset_required: false, onboarding_expires_at: null });
  });
});

describe("sign-in ends in a Clerk session", () => {
  it("returns a single-use Clerk ticket and no token for a capable browser", async () => {
    const result = await authService.createSessionAndTokens(PROFILE, null, null, { acceptsClerkTicket: true }, NEW_PW);

    expect(result).toMatchObject({ session_type: "clerk_ticket", sign_in_ticket: "ticket_xyz", access_token: null });
    expect(m.credentialService.issueSignInTicket).toHaveBeenCalledWith("user_2abc");
    expect(m.signInWithSupabasePassword).not.toHaveBeenCalled();
  });

  it("moves a not-yet-migrated profile onto Clerk with the password it just proved", async () => {
    m.credentialService.findLogin.mockResolvedValueOnce(null);
    m.credentialService.migrateOnSignIn.mockResolvedValueOnce("user_new");

    await authService.createSessionAndTokens(PROFILE, null, null, { acceptsClerkTicket: true }, "OldPassword1");

    expect(m.credentialService.migrateOnSignIn).toHaveBeenCalledWith(PROFILE, "OldPassword1");
    expect(m.credentialService.issueSignInTicket).toHaveBeenCalledWith("user_new");
  });

  it("never mints a Supabase session for a profile that has moved — an old tab is told to reload", async () => {
    await expect(
      authService.createSessionAndTokens(PROFILE, null, null, { acceptsClerkTicket: false }, NEW_PW),
    ).rejects.toThrow(/^CLIENT_UPDATE_REQUIRED/);
    expect(m.signInWithSupabasePassword).not.toHaveBeenCalled();
    expect(m.ensureSupabaseIdentity).not.toHaveBeenCalled();
  });

  it("refuses a login the Clerk webhook deactivated", async () => {
    m.credentialService.findLogin.mockResolvedValueOnce({ clerkUserId: "user_2abc", isActive: false });
    await expect(
      authService.createSessionAndTokens(PROFILE, null, null, { acceptsClerkTicket: true }, NEW_PW),
    ).rejects.toThrow(/^FORBIDDEN/);
  });
});

describe("signup is born on Clerk", () => {
  it("creates the profile with our own id and gives it a Clerk login — no hash, no Supabase identity", async () => {
    m.prisma.profile.findUnique.mockResolvedValueOnce(null); // email not taken
    m.prisma.profile.create.mockImplementation(async ({ data }: any) => data);
    m.credentialService.ensureLogin.mockResolvedValueOnce("user_new");

    const profile = await authService.selfSignUpTenant({
      email: "New@Example.com",
      password: NEW_PW,
      name: "New Person",
      phoneVerified: false,
    });

    const data = m.prisma.profile.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("password_hash");
    expect(data).not.toHaveProperty("auth_user_id");
    expect(data.email).toBe("new@example.com");
    expect(m.credentialService.ensureLogin).toHaveBeenCalledWith(profile, { kind: "new", password: NEW_PW });
  });

  it("removes the profile again if Clerk refuses, and refuses rather than adopts an address Clerk holds", async () => {
    m.prisma.profile.findUnique.mockResolvedValueOnce(null);
    m.prisma.profile.create.mockImplementation(async ({ data }: any) => data);
    m.prisma.profile.delete.mockResolvedValue({});
    m.credentialService.ensureLogin.mockRejectedValueOnce(
      Object.assign(new Error("taken"), { status: 422, errors: [{ code: "form_identifier_exists" }] }),
    );

    await expect(
      authService.selfSignUpTenant({ email: "g@example.com", password: NEW_PW, name: "G", phoneVerified: false }),
    ).rejects.toThrow(/^ALREADY_EXISTS/);
    expect(m.prisma.profile.delete).toHaveBeenCalledTimes(1);
  });
});
