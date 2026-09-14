/**
 * `/api/profiles/[id]` — who may read or write a profile by id (C1, 2026-09-14
 * security audit).
 *
 * The route used to restrict only TENANTs to their own id. Any OWNER — and
 * owner signup is public — could read every profile (password_hash included)
 * and rewrite any profile's email or phone, which chained into a takeover of
 * any account, ADMIN included.
 *
 * These call the real route handler and the real UserService; only the
 * session and the database are faked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSession, prisma } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  prisma: { profile: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/tenancy/active-tenancy", () => ({ getActiveTenancy: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/auth", () => ({
  getSession: mockSession,
  apiError: (message: string, code: string, status = 500) =>
    new Response(JSON.stringify({ success: false, error: { message, code } }), { status }),
  apiResponse: (data: any, status = 200) => new Response(JSON.stringify({ success: true, ...data }), { status }),
}));

import { GET, PUT } from "../app/api/profiles/[id]/route";

const ATTACKER_OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VICTIM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ownerSession = { sub: ATTACKER_OWNER, owner_id: ATTACKER_OWNER, role: "OWNER", email: "attacker@evil.test" };
const tenantSession = { sub: ATTACKER_OWNER, role: "TENANT", email: "attacker@evil.test" };
const adminSession = { sub: ADMIN, role: "ADMIN", email: "admin@stayo.test" };

const storedProfile = (id: string) => ({
  id,
  email: "victim@stayo.test",
  name: "Victim",
  phone: "+919999999999",
  role: "OWNER",
  owner_id: id,
  is_active: true,
  password_hash: "$2a$10$abcdefghijklmnopqrstuv",
  invitation_token: "live-invitation-token",
  auth_user_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
});

const req = (body: unknown = {}) => ({ json: async () => body }) as any;
const ctx = (id: string) => ({ params: { id } }) as any;
const bodyOf = async (res: Response) => JSON.parse(await res.text());

beforeEach(() => {
  vi.clearAllMocks();
  prisma.profile.findUnique.mockImplementation(async ({ where }: any) => storedProfile(where.id));
  prisma.profile.update.mockImplementation(async ({ where, data }: any) => ({ ...storedProfile(where.id), ...data }));
});

describe("GET /api/profiles/[id]", () => {
  it("refuses a request with no session", async () => {
    mockSession.mockResolvedValue(null);
    expect((await GET(req(), ctx(VICTIM))).status).toBe(401);
  });

  it("refuses an owner reading someone else's profile", async () => {
    mockSession.mockResolvedValue(ownerSession);
    const res = await GET(req(), ctx(VICTIM));
    expect(res.status).toBe(403);
    expect(prisma.profile.findUnique).not.toHaveBeenCalled();
  });

  it("refuses a tenant reading someone else's profile", async () => {
    mockSession.mockResolvedValue(tenantSession);
    expect((await GET(req(), ctx(VICTIM))).status).toBe(403);
  });

  it("lets a caller read their own profile, without credential fields", async () => {
    mockSession.mockResolvedValue(ownerSession);
    const res = await GET(req(), ctx(ATTACKER_OWNER));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.email).toBe("victim@stayo.test");
    expect(body).not.toHaveProperty("password_hash");
    expect(body).not.toHaveProperty("invitation_token");
    expect(body).not.toHaveProperty("auth_user_id");
  });

  it("lets an admin read any profile, still without credential fields", async () => {
    mockSession.mockResolvedValue(adminSession);
    const res = await GET(req(), ctx(VICTIM));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body).not.toHaveProperty("password_hash");
    expect(body).not.toHaveProperty("invitation_token");
    expect(body).not.toHaveProperty("auth_user_id");
  });
});

describe("PUT /api/profiles/[id]", () => {
  it("refuses a request with no session", async () => {
    mockSession.mockResolvedValue(null);
    expect((await PUT(req({ name: "x" }), ctx(VICTIM))).status).toBe(401);
    expect(prisma.profile.update).not.toHaveBeenCalled();
  });

  it("refuses an owner modifying another owner's profile", async () => {
    mockSession.mockResolvedValue(ownerSession);
    const res = await PUT(req({ email: "attacker@evil.test" }), ctx(VICTIM));
    expect(res.status).toBe(403);
    expect(prisma.profile.update).not.toHaveBeenCalled();
  });

  it("refuses a tenant modifying someone else's profile", async () => {
    mockSession.mockResolvedValue(tenantSession);
    expect((await PUT(req({ name: "x" }), ctx(VICTIM))).status).toBe(403);
    expect(prisma.profile.update).not.toHaveBeenCalled();
  });

  it("never writes identity or privilege fields, even on the caller's own profile", async () => {
    mockSession.mockResolvedValue(ownerSession);
    const res = await PUT(
      req({
        name: "New Name",
        email: "attacker@evil.test",
        phone: "+910000000000",
        role: "ADMIN",
        auth_user_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        password_hash: "x",
        invitation_token: "x",
        is_active: true,
        owner_id: VICTIM,
      }),
      ctx(ATTACKER_OWNER),
    );
    expect(res.status).toBe(200);
    expect(prisma.profile.update).toHaveBeenCalledTimes(1);
    expect(prisma.profile.update.mock.calls[0][0].data).toEqual({ name: "New Name" });
  });

  it("lets an admin edit another profile's plain fields, but not its email or phone", async () => {
    mockSession.mockResolvedValue(adminSession);
    const res = await PUT(req({ city: "Pune", email: "attacker@evil.test", phone: "+910000000000" }), ctx(VICTIM));
    expect(res.status).toBe(200);
    expect(prisma.profile.update.mock.calls[0][0]).toEqual({ where: { id: VICTIM }, data: { city: "Pune" } });
  });

  it("returns the updated profile without credential fields", async () => {
    mockSession.mockResolvedValue(ownerSession);
    const body = await bodyOf(await PUT(req({ name: "New Name" }), ctx(ATTACKER_OWNER)));
    expect(body.name).toBe("New Name");
    expect(body).not.toHaveProperty("password_hash");
    expect(body).not.toHaveProperty("invitation_token");
    expect(body).not.toHaveProperty("auth_user_id");
  });
});
