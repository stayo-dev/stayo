import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { authService } from "@/lib/services/auth-service";

vi.mock("@/lib/db", () => {
  const supabaseMock = {
    auth: {
      admin: {
        createUser: vi.fn(),
        updateUserById: vi.fn().mockResolvedValue({ error: null }),
        deleteUser: vi.fn().mockResolvedValue({}),
      },
    },
  };
  return {
    prisma: {
      profile: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
      tenants: { findUnique: vi.fn() },
      // auth.users lookup used to adopt an orphaned Supabase identity.
      $queryRaw: vi.fn(),
    },
    supabase: supabaseMock,
  };
});

vi.mock("@/lib/auth", async () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed"),
  verifyPassword: vi.fn(),
}));

const NEW_USER_ID = "11111111-2222-3333-4444-555555555555";

async function supabaseAdmin() {
  const mod: any = await import("@/lib/db");
  return mod.supabase.auth.admin;
}

const input = {
  email: "  Student@Example.com  ",
  password: "correct-horse",
  name: "Riya Sharma",
  phone: "918008046952",
  phoneVerified: false,
};

describe("selfSignUpTenant — marketplace account", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    (prisma as any).profile.findUnique.mockResolvedValue(null);
    (prisma as any).profile.findFirst.mockResolvedValue(null);
    (prisma as any).profile.create.mockImplementation(async ({ data }: any) => data);
    (prisma as any).$queryRaw.mockResolvedValue([]); // no orphaned auth user
    (await supabaseAdmin()).createUser.mockResolvedValue({
      data: { user: { id: NEW_USER_ID } },
      error: null,
    });
  });

  it("adopts an orphaned Supabase identity instead of failing", async () => {
    // Real case: signing in with Google on the lead flow creates an auth.users
    // row with no profile behind it. A blind createUser is then rejected and
    // the route surfaced an opaque 500.
    const ORPHAN_ID = "99999999-8888-7777-6666-555555555555";
    (prisma as any).$queryRaw.mockResolvedValue([{ id: ORPHAN_ID }]);
    const admin = await supabaseAdmin();

    const profile: any = await authService.selfSignUpTenant(input);

    expect(admin.createUser).not.toHaveBeenCalled();
    expect(admin.updateUserById).toHaveBeenCalledWith(ORPHAN_ID, expect.objectContaining({
      password: input.password,
      email_confirm: true,
    }));
    expect(profile.id).toBe(ORPHAN_ID);
    expect(profile.auth_user_id).toBe(ORPHAN_ID);
  });

  it("never deletes an adopted identity when the profile insert fails", async () => {
    const ORPHAN_ID = "99999999-8888-7777-6666-555555555555";
    (prisma as any).$queryRaw.mockResolvedValue([{ id: ORPHAN_ID }]);
    (prisma as any).profile.create.mockRejectedValue(new Error("db down"));
    const admin = await supabaseAdmin();

    await expect(authService.selfSignUpTenant(input)).rejects.toThrow("db down");
    // Deleting it would destroy a Supabase user that predates this signup.
    expect(admin.deleteUser).not.toHaveBeenCalled();
  });

  it("creates a TENANT profile and never a tenants row", async () => {
    const profile: any = await authService.selfSignUpTenant(input);

    expect(profile.role).toBe("TENANT");
    expect((prisma as any).tenants.findUnique).not.toHaveBeenCalled();
    // A tenants row would bind this person to a hostel/room/agreement that
    // does not exist yet — creating one here is the bug this guards against.
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

  it("normalises the email and is born linked to its Supabase identity", async () => {
    const profile: any = await authService.selfSignUpTenant(input);

    expect(profile.email).toBe("student@example.com");
    expect(profile.id).toBe(NEW_USER_ID);
    expect(profile.auth_user_id).toBe(NEW_USER_ID);
    expect(profile.auth_linked_at).toBeInstanceOf(Date);
  });

  it("carries the caller's phone-verification result onto the profile", async () => {
    const unverified: any = await authService.selfSignUpTenant(input);
    expect(unverified.phone_verified).toBe(false);
    expect(unverified.mobile_verified).toBe(false);

    vi.clearAllMocks();
    (prisma as any).profile.findUnique.mockResolvedValue(null);
    (prisma as any).profile.findFirst.mockResolvedValue(null);
    (prisma as any).profile.create.mockImplementation(async ({ data }: any) => data);
    (await supabaseAdmin()).createUser.mockResolvedValue({
      data: { user: { id: NEW_USER_ID } },
      error: null,
    });

    const verified: any = await authService.selfSignUpTenant({ ...input, phoneVerified: true });
    expect(verified.phone_verified).toBe(true);
    expect(verified.mobile_verified).toBe(true);
  });

  it("rejects a duplicate email before touching Supabase", async () => {
    (prisma as any).profile.findUnique.mockResolvedValue({ id: "existing" });

    await expect(authService.selfSignUpTenant(input)).rejects.toThrow("ALREADY_EXISTS");
    expect((await supabaseAdmin()).createUser).not.toHaveBeenCalled();
  });

  it("rejects a duplicate phone before touching Supabase", async () => {
    (prisma as any).profile.findFirst.mockResolvedValue({ id: "existing" });

    await expect(authService.selfSignUpTenant(input)).rejects.toThrow("ALREADY_EXISTS");
    expect((await supabaseAdmin()).createUser).not.toHaveBeenCalled();
  });

  it("rolls the Supabase user back if the profile insert fails", async () => {
    (prisma as any).profile.create.mockRejectedValue(new Error("db down"));

    await expect(authService.selfSignUpTenant(input)).rejects.toThrow("db down");
    expect((await supabaseAdmin()).deleteUser).toHaveBeenCalledWith(NEW_USER_ID);
  });

  it("throws loudly when the Supabase identity cannot be created", async () => {
    (await supabaseAdmin()).createUser.mockResolvedValue({
      data: { user: null },
      error: { message: "email taken upstream" },
    });

    await expect(authService.selfSignUpTenant(input)).rejects.toThrow("INTERNAL");
    expect((prisma as any).profile.create).not.toHaveBeenCalled();
  });
});
