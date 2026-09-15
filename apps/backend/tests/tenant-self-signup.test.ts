import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { authService } from "@/lib/services/auth-service";

/**
 * Self-serve tenant signup (ADR-035), born on Clerk (ADR-204).
 *
 * The account is a `profiles` row with our own UUID and a Clerk login bound
 * to it by id. There is no local password hash and no Supabase identity —
 * the orphaned-Supabase-identity adoption this file used to pin is gone, and
 * its Clerk analogue (an address Clerk already holds) is refused, not adopted.
 */

const { ensureLogin } = vi.hoisted(() => ({ ensureLogin: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: {
    profile: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    tenants: { findUnique: vi.fn() },
  },
}));
vi.mock("@/src/services/auth/credential-service", () => ({ credentialService: { ensureLogin } }));

const input = {
  email: "  Student@Example.com  ",
  password: "correct-horse",
  name: "Riya Sharma",
  phone: "918008046952",
  phoneVerified: false,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("selfSignUpTenant — marketplace account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma as any).profile.findUnique.mockResolvedValue(null);
    (prisma as any).profile.findFirst.mockResolvedValue(null);
    (prisma as any).profile.create.mockImplementation(async ({ data }: any) => data);
    (prisma as any).profile.delete.mockResolvedValue({});
    ensureLogin.mockResolvedValue("user_2new");
  });

  it("creates a TENANT profile and never a tenants row", async () => {
    const profile: any = await authService.selfSignUpTenant(input);

    expect(profile.role).toBe("TENANT");
    expect((prisma as any).tenants.findUnique).not.toHaveBeenCalled();
    expect((prisma as any).profile.create).toHaveBeenCalledTimes(1);
    const created = (prisma as any).profile.create.mock.calls[0][0].data;
    expect(created).not.toHaveProperty("tenants");
  });

  it("leaves owner_id unset — the account belongs to no hostel yet", async () => {
    const profile: any = await authService.selfSignUpTenant(input);
    expect(profile.owner_id).toBeUndefined();
  });

  it("marks the profile complete so the invited-tenant wizard doesn't trap it", async () => {
    const profile: any = await authService.selfSignUpTenant(input);
    expect(profile.is_profile_completed).toBe(true);
  });

  it("normalises the email, uses our own id, and is born with a Clerk login — no hash, no Supabase", async () => {
    const profile: any = await authService.selfSignUpTenant(input);

    expect(profile.email).toBe("student@example.com");
    expect(profile.id).toMatch(UUID_RE);
    expect(profile).not.toHaveProperty("auth_user_id");
    expect(profile).not.toHaveProperty("password_hash");
    expect(ensureLogin).toHaveBeenCalledWith(profile, { kind: "new", password: input.password });
  });

  it("carries the caller's phone-verification result onto the profile", async () => {
    const unverified: any = await authService.selfSignUpTenant(input);
    expect(unverified.phone_verified).toBe(false);
    expect(unverified.mobile_verified).toBe(false);

    const verified: any = await authService.selfSignUpTenant({ ...input, phoneVerified: true });
    expect(verified.phone_verified).toBe(true);
    expect(verified.mobile_verified).toBe(true);
  });

  it("rejects a duplicate email before touching Clerk", async () => {
    (prisma as any).profile.findUnique.mockResolvedValue({ id: "existing" });

    await expect(authService.selfSignUpTenant(input)).rejects.toThrow("ALREADY_EXISTS");
    expect(ensureLogin).not.toHaveBeenCalled();
  });

  // ADR-096: name, email and password only — the number comes at enquiry time.
  it("creates an account with no phone at all", async () => {
    const { phone, ...withoutPhone } = input;
    const profile: any = await authService.selfSignUpTenant({ ...withoutPhone, phoneVerified: false });

    expect(profile.phone).toBeNull();
    expect(profile.phone_verified).toBe(false);
    expect(profile.role).toBe("TENANT");
  });

  // `profiles.phone` is nullable AND unique: querying it with `null` would
  // match the first phone-less account and reject every signup after it.
  it("does not run the duplicate-phone lookup when there is no phone", async () => {
    const { phone, ...withoutPhone } = input;
    await authService.selfSignUpTenant({ ...withoutPhone, phoneVerified: false });

    expect((prisma as any).profile.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a duplicate phone before touching Clerk", async () => {
    (prisma as any).profile.findFirst.mockResolvedValue({ id: "existing" });

    await expect(authService.selfSignUpTenant(input)).rejects.toThrow("ALREADY_EXISTS");
    expect(ensureLogin).not.toHaveBeenCalled();
  });

  it("removes the profile again when Clerk cannot create the login", async () => {
    ensureLogin.mockRejectedValue(new Error("INTERNAL: Clerk unreachable"));

    await expect(authService.selfSignUpTenant(input)).rejects.toThrow("INTERNAL");
    const createdId = (prisma as any).profile.create.mock.calls[0][0].data.id;
    expect((prisma as any).profile.delete).toHaveBeenCalledWith({ where: { id: createdId } });
  });

  it("refuses — never adopts — an address Clerk already holds (e.g. from a Google sign-in)", async () => {
    ensureLogin.mockRejectedValue(
      Object.assign(new Error("That email address is taken."), { status: 422, errors: [{ code: "form_identifier_exists" }] }),
    );

    await expect(authService.selfSignUpTenant(input)).rejects.toThrow(/^ALREADY_EXISTS/);
    expect((prisma as any).profile.delete).toHaveBeenCalledTimes(1);
  });
});
