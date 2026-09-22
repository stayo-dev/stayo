import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` factories are hoisted above every `const` in this file, so the
// mock functions have to be hoisted with them. House pattern — see
// tests/bulk-import-room-execution.test.ts.
const { findUnique, findTenant, upsert, updateMany, isGuardianVerified } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findTenant: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
  isGuardianVerified: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    stay_guardian_consent: { findUnique, upsert, updateMany },
    tenants: { findUnique: findTenant },
  },
}));

vi.mock("@/lib/services/notifications/command-center/guardian-access", () => ({
  isGuardianVerified,
}));

// `normalizeWhatsAppPhone` lives in meta-provider.ts, which the barrel
// re-exports along with the provider class and several template contracts.
// Mocked so this test pulls in none of that.
vi.mock("@/lib/services/notifications/providers/whatsapp", () => ({
  normalizeWhatsAppPhone: (raw: string) => String(raw || "").replace(/\D/g, "").slice(-10),
}));

import {
  guardianViewFor,
  recordGuardianConsent,
  revokeGuardianConsent,
  stopGuardianConsent,
} from "@/src/services/stay/stay-guardian-consent";

const tenant = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  hostel_id: "h1",
  phone_1: "9123456789",
  phone_2: null,
  guardian_name: "Ramesh",
  guardian_phone: "9876543210",
  profiles: { name: "Aarav", phone: "9123456789" },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  isGuardianVerified.mockResolvedValue(true);
  findUnique.mockResolvedValue(null);
});

describe("guardianViewFor", () => {
  it("is eligible and UNASKED for a verified guardian with no row yet", async () => {
    findTenant.mockResolvedValue(tenant());
    expect(await guardianViewFor("t1")).toEqual({
      eligible: true,
      name: "Ramesh",
      consent: "UNASKED",
    });
  });

  it("is null when the tenancy has no guardian number at all", async () => {
    findTenant.mockResolvedValue(tenant({ guardian_phone: null, phone_2: null }));
    expect(await guardianViewFor("t1")).toBeNull();
  });

  it("is ineligible when the guardian number is the resident's own", async () => {
    findTenant.mockResolvedValue(tenant({ guardian_phone: "+91 91234 56789" }));
    const view = await guardianViewFor("t1");
    expect(view?.eligible).toBe(false);
  });

  it("is ineligible when the guardian was never OTP-verified (ADR-212 deferral)", async () => {
    findTenant.mockResolvedValue(tenant());
    isGuardianVerified.mockResolvedValue(false);
    const view = await guardianViewFor("t1");
    expect(view?.eligible).toBe(false);
    expect(view?.consent).toBe("UNASKED");
  });

  it("reports PHONE_CHANGED as UNASKED, so the tenant is asked about the new person", async () => {
    findTenant.mockResolvedValue(tenant({ guardian_phone: "9000000001" }));
    findUnique.mockResolvedValue({
      granted: true,
      guardian_phone: "9876543210",
      revoked_at: null,
      stopped_at: null,
    });
    const view = await guardianViewFor("t1");
    expect(view?.consent).toBe("UNASKED");
  });

  it("surfaces a guardian STOP distinctly from a tenant revocation", async () => {
    findTenant.mockResolvedValue(tenant());
    findUnique.mockResolvedValue({
      granted: true,
      guardian_phone: "9876543210",
      revoked_at: null,
      stopped_at: new Date(),
    });
    expect((await guardianViewFor("t1"))?.consent).toBe("STOPPED");
  });

  it("falls back to phone_2 when guardian_phone is unset", async () => {
    // tenant-service keeps the two in step, but activation writes phone_2
    // first on some paths — guardian-activation.ts reads both for this reason.
    findTenant.mockResolvedValue(tenant({ guardian_phone: null, phone_2: "9876543210" }));
    expect((await guardianViewFor("t1"))?.eligible).toBe(true);
  });
});

describe("recordGuardianConsent", () => {
  it("snapshots the guardian number it was given for", async () => {
    findTenant.mockResolvedValue(tenant());
    await recordGuardianConsent({ tenantId: "t1", granted: true, source: "APP" });

    const args = upsert.mock.calls[0][0];
    expect(args.where).toEqual({ tenant_id: "t1" });
    expect(args.create.guardian_phone).toBe("9876543210");
    expect(args.create.granted).toBe(true);
    expect(args.create.source).toBe("APP");
  });

  it("clears a previous revocation when consent is granted afresh", async () => {
    findTenant.mockResolvedValue(tenant());
    await recordGuardianConsent({ tenantId: "t1", granted: true, source: "QR" });
    expect(upsert.mock.calls[0][0].update.revoked_at).toBeNull();
  });

  it("never clears stopped_at — a guardian's STOP is not the tenant's to undo", async () => {
    findTenant.mockResolvedValue(tenant());
    await recordGuardianConsent({ tenantId: "t1", granted: true, source: "APP" });
    const { update, create } = upsert.mock.calls[0][0];
    expect(Object.keys(update)).not.toContain("stopped_at");
    expect(create.stopped_at ?? null).toBeNull();
  });

  it("refuses when there is no guardian to consent about", async () => {
    findTenant.mockResolvedValue(tenant({ guardian_phone: null, phone_2: null }));
    expect(await recordGuardianConsent({ tenantId: "t1", granted: true, source: "APP" })).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("revoke and stop write different columns", () => {
  it("revoke sets revoked_at only", async () => {
    await revokeGuardianConsent("t1");
    expect(updateMany.mock.calls[0][0].data).toHaveProperty("revoked_at");
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty("stopped_at");
  });

  it("stop sets stopped_at only", async () => {
    await stopGuardianConsent("t1");
    expect(updateMany.mock.calls[0][0].data).toHaveProperty("stopped_at");
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty("revoked_at");
  });
});
