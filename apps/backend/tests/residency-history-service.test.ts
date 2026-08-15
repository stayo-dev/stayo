import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    tenants: { findMany: vi.fn(), findFirst: vi.fn() },
    visitorLead: { findMany: vi.fn(), findFirst: vi.fn() },
    hostels: { findFirst: vi.fn(), findUnique: vi.fn() },
    residency_history_disclosures: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
  },
  supabase: {},
}));

import { prisma } from "@/lib/db";
import { residencyHistoryService } from "@/src/services/profile/residency-history-service";

const tenants = () => (prisma as any).tenants;
const leads = () => (prisma as any).visitorLead;
const hostels = () => (prisma as any).hostels;
const disclosures = () => (prisma as any).residency_history_disclosures;

function tenancy(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    status: "FORMER_TENANT",
    joined_on: new Date("2026-01-10"),
    exit_date: new Date("2026-04-10"),
    monthly_rent: 6500,
    activation_completed_at: new Date("2026-01-10"),
    created_at: new Date("2026-01-01"),
    hostels: { id: "h1", name: "Sri Adithya", city: "Hyderabad" },
    room_allocations: [{ room: { room_no: "204", capacity: 4, room_type: "AC" } }],
    move_out_requests: [{ id: "m1" }],
    exit_reason: "DISPUTE",
    exit_notes: "Argued about the deposit",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  disclosures().findUnique.mockResolvedValue(null);
  tenants().findFirst.mockResolvedValue(null);
  leads().findFirst.mockResolvedValue(null);
});

describe("the facts projection", () => {
  it("never leaks the previous owner's judgement", async () => {
    tenants().findMany.mockResolvedValueOnce([tenancy()]);

    const { stays } = await residencyHistoryService.getOwnHistory("p1");

    // A single bad exit must not follow someone across every hostel on Stayo
    // with no right of reply.
    expect(stays[0]).not.toHaveProperty("exit_reason");
    expect(stays[0]).not.toHaveProperty("exit_notes");
    expect(JSON.stringify(stays[0])).not.toContain("Argued about the deposit");
  });

  it("reports the checkable facts an owner actually needs", async () => {
    tenants().findMany.mockResolvedValueOnce([tenancy()]);

    const { stays } = await residencyHistoryService.getOwnHistory("p1");

    expect(stays[0]).toMatchObject({
      hostel: { name: "Sri Adithya", city: "Hyderabad" },
      room_no: "204",
      sharing: 4,
      monthly_rent: 6500,
      settled: true,
      duration_months: 3,
    });
  });

  it("counts a stay inside one calendar month as one month, not zero", async () => {
    tenants().findMany.mockResolvedValueOnce([
      tenancy({ joined_on: new Date("2026-03-02"), exit_date: new Date("2026-03-28") }),
    ]);

    const { stays } = await residencyHistoryService.getOwnHistory("p1");
    expect(stays[0].duration_months).toBe(1);
  });

  it("marks an unsettled stay as unsettled", async () => {
    tenants().findMany.mockResolvedValueOnce([tenancy({ move_out_requests: [] })]);

    const { stays } = await residencyHistoryService.getOwnHistory("p1");
    expect(stays[0].settled).toBe(false);
  });

  it("omits an invitation the person never took up", async () => {
    // Never arriving is not a stay, and showing it as one would misrepresent
    // someone's history to the next owner.
    tenants().findMany.mockResolvedValueOnce([
      tenancy({ id: "t2", status: "EXPIRED", activation_completed_at: null }),
    ]);

    const { stays } = await residencyHistoryService.getOwnHistory("p1");
    expect(stays).toHaveLength(0);
  });

  it("keeps a live tenancy and marks it current", async () => {
    tenants().findMany.mockResolvedValueOnce([tenancy({ status: "ACTIVE", exit_date: null })]);

    const { stays, total_stays } = await residencyHistoryService.getOwnHistory("p1");
    expect(stays[0].is_current).toBe(true);
    // "total_stays" means completed ones — a current stay is not history yet.
    expect(total_stays).toBe(0);
  });
});

describe("access: earned by engagement, overridden by the tenant", () => {
  it("refuses an owner the person has never engaged", async () => {
    const access = await residencyHistoryService.resolveAccess("p1", "h1");
    expect(access).toEqual({ allowed: false, reason: "NOT_ENGAGED" });
  });

  it("allows a hostel the person holds a tenancy at", async () => {
    tenants().findFirst.mockResolvedValueOnce({ id: "t1" });
    const access = await residencyHistoryService.resolveAccess("p1", "h1");
    expect(access).toEqual({ allowed: true, reason: "TENANCY" });
  });

  it("allows a hostel with an open enquiry from this person", async () => {
    leads().findFirst.mockResolvedValueOnce({ id: "l1" });
    const access = await residencyHistoryService.resolveAccess("p1", "h1");
    expect(access).toEqual({ allowed: true, reason: "OPEN_ENQUIRY" });
  });

  it("lets a revocation beat engagement", async () => {
    // The whole point of giving the tenant control: their "no" must outrank a
    // tenancy that would otherwise disclose automatically.
    disclosures().findUnique.mockResolvedValueOnce({ status: "REVOKED" });
    tenants().findFirst.mockResolvedValue({ id: "t1" });

    const access = await residencyHistoryService.resolveAccess("p1", "h1");

    expect(access).toEqual({ allowed: false, reason: "TENANT_DECLINED" });
    // Short-circuits before looking for engagement at all: a refusal must not
    // depend on what the engagement lookup happens to find.
    expect(tenants().findFirst).not.toHaveBeenCalled();
  });

  it("lets an explicit approval stand in for engagement", async () => {
    disclosures().findUnique.mockResolvedValueOnce({ status: "APPROVED" });
    const access = await residencyHistoryService.resolveAccess("p1", "h1");
    expect(access).toEqual({ allowed: true, reason: "TENANT_APPROVED" });
  });

  it("distinguishes a pending request from a plain refusal", async () => {
    disclosures().findUnique.mockResolvedValueOnce({ status: "REQUESTED" });
    const access = await residencyHistoryService.resolveAccess("p1", "h1");
    expect(access).toEqual({ allowed: false, reason: "AWAITING_TENANT" });
  });
});

describe("the owner-facing read keeps ADR-053's protection", () => {
  it("refuses a hostel the caller does not own", async () => {
    hostels().findFirst.mockResolvedValueOnce(null);

    await expect(residencyHistoryService.getDisclosedHistory("owner-b", "h1", "p1")).rejects.toThrow(
      /do not manage this hostel/i,
    );
    expect(tenants().findMany).not.toHaveBeenCalled();
  });

  it("returns nothing at all to an owner who has not earned access", async () => {
    hostels().findFirst.mockResolvedValueOnce({ id: "h1" });

    const result = await residencyHistoryService.getDisclosedHistory("owner-a", "h1", "p1");

    expect(result.allowed).toBe(false);
    expect(result.stays).toEqual([]);
    // An owner who types a stranger's id must not even learn whether that
    // person has a history — that is the enumeration attack ADR-053 blocks.
    expect(result.total_stays).toBe(0);
    expect(tenants().findMany).not.toHaveBeenCalled();
  });

  it("returns the history once access is earned", async () => {
    hostels().findFirst.mockResolvedValueOnce({ id: "h1" });
    tenants().findFirst.mockResolvedValueOnce({ id: "t1" });
    tenants().findMany.mockResolvedValueOnce([tenancy()]);

    const result = await residencyHistoryService.getDisclosedHistory("owner-a", "h1", "p1");

    expect(result.allowed).toBe(true);
    expect(result.stays).toHaveLength(1);
  });
});

describe("requesting access", () => {
  beforeEach(() => {
    hostels().findFirst.mockResolvedValue({ id: "h1" });
    disclosures().upsert.mockResolvedValue({});
  });

  it("refuses to request against a hostel the caller does not own", async () => {
    hostels().findFirst.mockResolvedValueOnce(null);
    await expect(residencyHistoryService.requestAccess("owner-b", "h1", "p1")).rejects.toThrow(
      /do not manage this hostel/i,
    );
  });

  it("creates a pending request that grants nothing by itself", async () => {
    disclosures().findUnique.mockResolvedValueOnce(null);

    const result = await residencyHistoryService.requestAccess("owner-a", "h1", "p1");

    expect(result).toEqual({ requested: true, status: "REQUESTED" });
    expect(disclosures().upsert.mock.calls[0][0].create.status).toBe("REQUESTED");
  });

  it("will not re-open a decision the tenant already refused", async () => {
    // Otherwise "no" becomes a nag, and the repeated ask is itself a message
    // the tenant never consented to receiving.
    disclosures().findUnique.mockResolvedValueOnce({ status: "DECLINED" });

    const result = await residencyHistoryService.requestAccess("owner-a", "h1", "p1");

    expect(result).toEqual({ requested: false, status: "DECLINED" });
    expect(disclosures().upsert).not.toHaveBeenCalled();
  });

  it("does not re-request what is already approved", async () => {
    disclosures().findUnique.mockResolvedValueOnce({ status: "APPROVED" });

    const result = await residencyHistoryService.requestAccess("owner-a", "h1", "p1");
    expect(result).toEqual({ requested: false, status: "APPROVED" });
    expect(disclosures().upsert).not.toHaveBeenCalled();
  });
});
