import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSession, mockService, mockPhoto, mockDb, mockLog } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockService: { getForOwner: vi.fn(), updateByOwner: vi.fn(), getForAdmin: vi.fn(), updateByAdmin: vi.fn() },
  mockPhoto: { checkOwnerPhoto: vi.fn(), saveOwnerPhoto: vi.fn(), clearOwnerPhoto: vi.fn() },
  mockDb: { profile: { findFirst: vi.fn() } },
  mockLog: { log: vi.fn(async () => undefined) },
}));

vi.mock("@/lib/db", () => ({ prisma: mockDb }));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: mockLog }));
vi.mock("@/lib/auth", () => ({
  getSession: mockSession,
  apiError: (message: string, code = "ERROR", status = 500) =>
    new Response(JSON.stringify({ success: false, error: { message, code } }), { status }),
  apiResponse: (data: any, status = 200) => new Response(JSON.stringify({ success: true, ...data }), { status }),
}));
vi.mock("@/lib/owner-photo", () => mockPhoto);
vi.mock("@/src/services/host-profile/host-profile-service", async () => {
  const actual: any = await vi.importActual("@/src/services/host-profile/host-profile-service");
  return { HostProfileError: actual.HostProfileError, hostProfileService: mockService };
});

import { GET as ownerGet, PUT as ownerPut } from "../app/api/owner/me/host-profile/route";
import { GET as adminGet, PATCH as adminPatch } from "../app/api/platform-admin/owners/[id]/host-profile/route";
import { POST as adminPhotoPost, DELETE as adminPhotoDelete } from "../app/api/platform-admin/owners/[id]/photo/route";
import { HostProfileError } from "@/src/services/host-profile/host-profile-service";

const OWNER = { sub: "o1", role: "OWNER" };
const ADMIN = { sub: "admin-1", role: "ADMIN" };
const TENANT = { sub: "t1", role: "TENANT" };
const jsonReq = (body: unknown) => ({ json: async () => body }) as any;
const formReq = (file: unknown) => ({ formData: async () => ({ get: () => file }) }) as any;
const ctx = { params: { id: "o1" } };
const read = async (res: Response) => ({ status: res.status, body: await res.json() });

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.profile.findFirst.mockResolvedValue({ id: "o1" });
});

describe("owner host-profile route", () => {
  it("is for owners only", async () => {
    mockSession.mockResolvedValue(TENANT);
    expect((await ownerGet(jsonReq({}))).status).toBe(403);
    expect((await ownerPut(jsonReq({}))).status).toBe(403);
    mockSession.mockResolvedValue(ADMIN);
    expect((await ownerGet(jsonReq({}))).status).toBe(403);
  });

  it("reads and writes the session owner's own profile", async () => {
    mockSession.mockResolvedValue(OWNER);
    mockService.getForOwner.mockResolvedValue({ name: "Shiva Prakash" });
    expect(await read(await ownerGet(jsonReq({})))).toEqual({ status: 200, body: { success: true, data: { name: "Shiva Prakash" } } });

    mockService.updateByOwner.mockResolvedValue({ bio: "Hi" });
    const res = await read(await ownerPut(jsonReq({ bio: "Hi", languages: [], hosting_since: null })));
    expect(res.status).toBe(200);
    expect(mockService.updateByOwner).toHaveBeenCalledWith("o1", { bio: "Hi", languages: [], hosting_since: null });
  });

  it("returns the rule's own reason on a refused bio", async () => {
    mockSession.mockResolvedValue(OWNER);
    mockService.updateByOwner.mockRejectedValue(new HostProfileError("VALIDATION_ERROR", 400, "Remove the phone number — residents reach you through Stayo."));
    const res = await read(await ownerPut(jsonReq({ bio: "9876543210" })));
    expect(res).toEqual({
      status: 400,
      body: { success: false, error: { message: "Remove the phone number — residents reach you through Stayo.", code: "VALIDATION_ERROR" } },
    });
  });

  it("refuses a body that is not an object", async () => {
    mockSession.mockResolvedValue(OWNER);
    expect((await ownerPut(jsonReq(null))).status).toBe(400);
  });
});

describe("admin host-profile route", () => {
  it("is for admins only", async () => {
    mockSession.mockResolvedValue(OWNER);
    expect((await adminGet(jsonReq({}), ctx)).status).toBe(403);
    expect((await adminPatch(jsonReq({ bio_hidden: true }), ctx)).status).toBe(403);
  });

  it("passes the admin's id so the edit is attributed", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockService.updateByAdmin.mockResolvedValue({ bio_hidden: true });
    expect((await adminPatch(jsonReq({ bio_hidden: true }), ctx)).status).toBe(200);
    expect(mockService.updateByAdmin).toHaveBeenCalledWith("o1", "admin-1", { bio_hidden: true });
  });

  it("maps a missing owner to 404", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockService.getForAdmin.mockRejectedValue(new HostProfileError("NOT_FOUND", 404, "Owner not found"));
    expect((await adminGet(jsonReq({}), ctx)).status).toBe(404);
  });
});

describe("admin owner-photo route", () => {
  it("is for admins only", async () => {
    mockSession.mockResolvedValue(OWNER);
    expect((await adminPhotoPost(formReq({}), ctx)).status).toBe(403);
    expect((await adminPhotoDelete(jsonReq({}), ctx)).status).toBe(403);
  });

  it("refuses a bad file with the helper's reason", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockPhoto.checkOwnerPhoto.mockReturnValue("Photo must be under 2MB");
    const res = await read(await adminPhotoPost(formReq({ type: "image/png", size: 9e6 }), ctx));
    expect(res.status).toBe(400);
    expect(mockPhoto.saveOwnerPhoto).not.toHaveBeenCalled();
  });

  it("404s when the profile is not an owner", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockDb.profile.findFirst.mockResolvedValue(null);
    expect((await adminPhotoDelete(jsonReq({}), ctx)).status).toBe(404);
  });

  it("replaces and removes the owner's photo, and logs it", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockPhoto.checkOwnerPhoto.mockReturnValue(null);
    mockPhoto.saveOwnerPhoto.mockResolvedValue({ photo_url: "https://ik.example/new.jpg" });
    const file = { type: "image/png", size: 100 };
    expect(await read(await adminPhotoPost(formReq(file), ctx))).toEqual({
      status: 200, body: { success: true, data: { photo_url: "https://ik.example/new.jpg" } },
    });
    expect(mockPhoto.saveOwnerPhoto).toHaveBeenCalledWith("o1", file, ["ADMIN_REPLACED"]);

    mockPhoto.clearOwnerPhoto.mockResolvedValue({ photo_url: null });
    expect((await adminPhotoDelete(jsonReq({}), ctx)).status).toBe(200);
    expect(mockLog.log).toHaveBeenCalledWith("OWNER_HOST_PROFILE_ADMIN_EDIT", "o1", { fields: ["photo"], admin_id: "admin-1" });
  });
});
