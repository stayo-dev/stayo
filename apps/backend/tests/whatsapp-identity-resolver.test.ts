import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveSenderIdentity, getPhoneCandidates } from "@/lib/services/notifications/routing/identity-resolver";
import { prisma } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    tenants: { findMany: vi.fn() },
    profiles: { findFirst: vi.fn() },
    hostels: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/logger", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), metrics: vi.fn() };
  return { getLogger: () => logger };
});

const noOwner = () => vi.mocked(prisma.$queryRaw).mockResolvedValue([] as any);
const noTenants = () => vi.mocked(prisma.tenants.findMany).mockResolvedValue([] as any);
const noAdmin = () => vi.mocked(prisma.profiles.findFirst).mockResolvedValue(null as any);
const noHostels = () => vi.mocked(prisma.hostels.findMany).mockResolvedValue([] as any);

describe("getPhoneCandidates", () => {
  it("covers the stored variants of an Indian number", () => {
    const candidates = getPhoneCandidates("917901070333");
    expect(candidates).toContain("917901070333");
    expect(candidates).toContain("7901070333");
    expect(candidates).toContain("+917901070333");
  });

  it("expands a bare 10-digit number upward too", () => {
    const candidates = getPhoneCandidates("7901070333");
    expect(candidates).toContain("917901070333");
    expect(candidates).toContain("+917901070333");
  });

  it("returns nothing for a number with no digits", () => {
    expect(getPhoneCandidates("not-a-number")).toEqual([]);
  });
});

describe("resolveSenderIdentity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    noOwner();
    noTenants();
    noAdmin();
    noHostels();
  });

  it("returns UNKNOWN rather than throwing for a number we have never seen", async () => {
    const identity = await resolveSenderIdentity("917901070333");

    expect(identity.role).toBe("UNKNOWN");
    expect(identity.roles).toEqual(["UNKNOWN"]);
    expect(identity.ownerId).toBeNull();
    expect(identity.tenantIds).toEqual([]);
  });

  it("resolves a verified owner", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ owner_id: "owner-1" }] as any);

    const identity = await resolveSenderIdentity("917901070333");

    expect(identity.role).toBe("OWNER");
    expect(identity.ownerId).toBe("owner-1");
  });

  it("resolves an active tenant and keeps every matching tenant id", async () => {
    vi.mocked(prisma.tenants.findMany).mockResolvedValue([
      { id: "t-1", hostel_id: "h-1", phone_1: "917901070333", status: "ACTIVE", profiles: { id: "p-1", name: "Rahul" } },
      { id: "t-2", hostel_id: "h-1", guardian_phone: "917901070333", status: "INVITED", profiles: null, guardian_name: "Guardian" },
    ] as any);

    const identity = await resolveSenderIdentity("917901070333");

    expect(identity.role).toBe("TENANT");
    expect(identity.tenantIds).toEqual(["t-1", "t-2"]);
    expect(identity.displayName).toBe("Rahul");
  });

  it("ignores tenants who are no longer active", async () => {
    vi.mocked(prisma.tenants.findMany).mockResolvedValue([
      { id: "t-old", hostel_id: "h-1", status: "MOVED_OUT", profiles: { id: "p", name: "Past" } },
    ] as any);

    const identity = await resolveSenderIdentity("917901070333");

    expect(identity.role).toBe("UNKNOWN");
    expect(identity.tenantIds).toEqual([]);
  });

  it("carries every role a phone holds, with OWNER taking precedence", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ owner_id: "owner-1" }] as any);
    vi.mocked(prisma.tenants.findMany).mockResolvedValue([
      { id: "t-1", hostel_id: "h-1", phone_1: "917901070333", status: "ACTIVE", profiles: { id: "p-1", name: "Rahul" } },
    ] as any);

    const identity = await resolveSenderIdentity("917901070333");

    expect(identity.role).toBe("OWNER");
    expect(identity.roles).toEqual(["OWNER", "TENANT"]);
    expect(identity.tenantIds).toEqual(["t-1"]);
  });

  it("resolves an ADMIN profile", async () => {
    vi.mocked(prisma.profiles.findFirst).mockResolvedValue({ id: "a-1", name: "Admin" } as any);

    const identity = await resolveSenderIdentity("917901070333");

    expect(identity.role).toBe("ADMIN");
    expect(identity.roles).toEqual(["ADMIN"]);
  });

  it("degrades to not-an-owner when the owner identity table is missing", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(
      Object.assign(new Error("relation does not exist"), { code: "P2010", meta: { code: "42P01" } })
    );

    const identity = await resolveSenderIdentity("917901070333");

    expect(identity.role).toBe("UNKNOWN");
  });

  it("still propagates a genuine database failure", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("connection reset"));

    await expect(resolveSenderIdentity("917901070333")).rejects.toThrow("connection reset");
  });
});

describe("resolved entity context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    noOwner();
    noTenants();
    noAdmin();
    noHostels();
  });

  it("pins tenantId and hostelId only when the phone maps to exactly one", async () => {
    vi.mocked(prisma.tenants.findMany).mockResolvedValue([
      { id: "t-1", hostel_id: "h-1", phone_1: "917901070333", status: "ACTIVE", profiles: { id: "p-1", name: "Rahul" } },
    ] as any);

    const identity = await resolveSenderIdentity("917901070333");

    expect(identity.tenantId).toBe("t-1");
    expect(identity.hostelId).toBe("h-1");
    expect(identity.residents[0]).toMatchObject({ tenantId: "t-1", hostelId: "h-1", matchedVia: "OWN_PHONE" });
  });

  it("leaves tenantId null for a guardian paying for two siblings — never picks the first", async () => {
    vi.mocked(prisma.tenants.findMany).mockResolvedValue([
      { id: "t-1", hostel_id: "h-1", guardian_phone: "917901070333", status: "ACTIVE", profiles: { name: "A" } },
      { id: "t-2", hostel_id: "h-2", guardian_phone: "917901070333", status: "ACTIVE", profiles: { name: "B" } },
    ] as any);

    const identity = await resolveSenderIdentity("917901070333");

    expect(identity.tenantId).toBeNull();
    expect(identity.tenantIds).toEqual(["t-1", "t-2"]);
    expect(identity.hostelId).toBeNull();
    expect(identity.hostelIds).toEqual(["h-1", "h-2"]);
  });

  it("collapses to one hostelId when both siblings live in the same hostel", async () => {
    vi.mocked(prisma.tenants.findMany).mockResolvedValue([
      { id: "t-1", hostel_id: "h-1", guardian_phone: "917901070333", status: "ACTIVE", profiles: { name: "A" } },
      { id: "t-2", hostel_id: "h-1", guardian_phone: "917901070333", status: "ACTIVE", profiles: { name: "B" } },
    ] as any);

    const identity = await resolveSenderIdentity("917901070333");

    expect(identity.tenantId).toBeNull();
    expect(identity.hostelId).toBe("h-1");
  });

  it("does not pin hostelId for an owner with several hostels", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ owner_id: "owner-1" }] as any);
    vi.mocked(prisma.hostels.findMany).mockResolvedValue([{ id: "h-1" }, { id: "h-2" }] as any);

    const identity = await resolveSenderIdentity("917901070333");

    expect(identity.hostelIds).toEqual(["h-1", "h-2"]);
    expect(identity.hostelId).toBeNull();
  });

  it("trusts an own-phone match more than a guardian-phone match", async () => {
    vi.mocked(prisma.tenants.findMany).mockResolvedValue([
      { id: "t-1", hostel_id: "h-1", phone_1: "917901070333", status: "ACTIVE", profiles: { name: "A" } },
    ] as any);
    const own = await resolveSenderIdentity("917901070333");

    vi.mocked(prisma.tenants.findMany).mockResolvedValue([
      { id: "t-2", hostel_id: "h-1", guardian_phone: "917901070333", status: "ACTIVE", profiles: { name: "B" } },
    ] as any);
    const guardian = await resolveSenderIdentity("917901070333");

    expect(own.confidence).toBeGreaterThan(guardian.confidence);
    expect(own.residents[0].matchedVia).toBe("OWN_PHONE");
    expect(guardian.residents[0].matchedVia).toBe("GUARDIAN_PHONE");
  });

  it("grants a verified owner full confidence and the owner-console permission", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ owner_id: "owner-1" }] as any);

    const identity = await resolveSenderIdentity("917901070333");

    expect(identity.confidence).toBe(1);
    expect(identity.permissions).toContain("owner.console");
  });

  it("gives an unknown sender self-service only — never billing", async () => {
    const identity = await resolveSenderIdentity("917901070333");

    expect(identity.permissions).toEqual(["self.service"]);
    expect(identity.confidence).toBe(0);
  });
});
