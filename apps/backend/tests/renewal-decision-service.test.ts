import { describe, expect, it, vi } from "vitest";
import { RenewalDecisionService, resolveRenewalGracePeriodDays } from "@/src/services/tenants/renewal-decision-service";

const baseAgreement = {
  id: "agreement-1",
  tenant_id: "tenant-1",
  hostel_id: "hostel-1",
  status: "SIGNED",
  agreement_version: 1,
  agreement_end_date: new Date("2026-08-01T00:00:00.000Z"),
  contract_rent: 8000,
  contract_security_deposit: 10000,
  contract_maintenance: 1200,
  contract_maintenance_type: "ONE_TIME",
  contract_payment_frequency: "MONTHLY",
  renewed_to_agreement_id: null,
  renewed_to_agreement: null,
  renewed_agreements: [],
  hostel: {
    id: "hostel-1",
    owner_id: "owner-1",
    preferences_config: { renewal_grace_period_days: 30 },
  },
  tenant: {
    id: "tenant-1",
    status: "ACTIVE",
    profile_id: "profile-1",
    profiles: { name: "Tenant One", phone: "9999999999" },
    room_allocations: [{ is_active: true, end_date: null, room: { id: "room-1", room_no: "101" } }],
    move_out_requests: [],
    rent_obligations: [],
  },
};

function agreement(overrides: Record<string, any> = {}) {
  return {
    ...baseAgreement,
    ...overrides,
    hostel: { ...baseAgreement.hostel, ...(overrides.hostel || {}) },
    tenant: { ...baseAgreement.tenant, ...(overrides.tenant || {}) },
  };
}

describe("RenewalDecisionService", () => {
  const now = new Date("2026-06-14T00:00:00.000Z");
  const service = new RenewalDecisionService({} as any);

  it("resolves grace period from hostel preferences with a default", () => {
    expect(resolveRenewalGracePeriodDays({ preferences_config: { renewal_grace_period_days: 45 } })).toBe(45);
    expect(resolveRenewalGracePeriodDays({ preferences_config: { renewal_grace_period_days: "bad" } })).toBe(30);
  });

  it("marks a signed agreement as current when it is not near expiry", () => {
    const decision = service.evaluateAgreement(agreement(), now);
    expect(decision.decision_state).toBe("CURRENT");
    expect(decision.renewal_available).toBe(false);
  });

  it("marks expiring agreements as renewal available", () => {
    const decision = service.evaluateAgreement(agreement({ status: "EXPIRING_SOON" }), now);
    expect(decision.states).toContain("EXPIRING_SOON");
    expect(decision.states).toContain("RENEWAL_AVAILABLE");
    expect(decision.renewal_available).toBe(true);
  });

  it("marks expired occupied agreements as decision pending", () => {
    const decision = service.evaluateAgreement(agreement({
      status: "AGREEMENT_EXPIRED",
      agreement_end_date: new Date("2026-06-01T00:00:00.000Z"),
    }), now);
    expect(decision.states).toContain("RENEWAL_DECISION_PENDING");
    expect(decision.renewal_available).toBe(true);
    expect(decision.days_overdue).toBe(13);
  });

  it("marks expired agreements beyond grace as critical", () => {
    const decision = service.evaluateAgreement(agreement({
      status: "AGREEMENT_EXPIRED",
      agreement_end_date: new Date("2026-04-01T00:00:00.000Z"),
    }), now);
    expect(decision.decision_state).toBe("RENEWAL_OVERDUE_CRITICAL");
    expect(decision.states).toContain("RENEWAL_OVERDUE_CRITICAL");
  });

  it("marks expired agreements with overdue rent as highest risk", () => {
    const decision = service.evaluateAgreement(agreement({
      status: "AGREEMENT_EXPIRED",
      agreement_end_date: new Date("2026-06-01T00:00:00.000Z"),
      tenant: {
        rent_obligations: [{
          status: "PENDING",
          is_superseded: false,
          due_date: new Date("2026-05-31T00:00:00.000Z"),
          total_amount: 8000,
        }],
      },
    }), now);
    expect(decision.decision_state).toBe("EXPIRED_AND_RENT_OVERDUE");
    expect(decision.overdue_rent).toMatchObject({ count: 1, amount: 8000 });
  });

  it("blocks renewal while move-out is in progress", () => {
    const decision = service.evaluateAgreement(agreement({
      status: "AGREEMENT_EXPIRED",
      tenant: {
        move_out_requests: [{ id: "move-1", status: "REQUESTED", planned_exit_date: new Date("2026-06-30T00:00:00.000Z") }],
      },
    }), now);
    expect(decision.decision_state).toBe("MOVE_OUT_IN_PROGRESS");
    expect(decision.renewal_available).toBe(false);
  });

  it("blocks renewal after completed move-out and no occupancy", () => {
    const decision = service.evaluateAgreement(agreement({
      status: "AGREEMENT_EXPIRED",
      tenant: {
        status: "FORMER_TENANT",
        room_allocations: [],
        move_out_requests: [{ id: "move-1", status: "COMPLETED" }],
      },
    }), now);
    expect(decision.decision_state).toBe("RENEWAL_BLOCKED_MOVED_OUT");
  });

  it("sorts the owner queue by criticality and filters buckets", async () => {
    const db = {
      agreement: {
        findMany: vi.fn().mockResolvedValue([
          agreement({ id: "expiring", status: "EXPIRING_SOON", agreement_end_date: new Date("2026-06-20T00:00:00.000Z") }),
          agreement({ id: "critical", status: "AGREEMENT_EXPIRED", agreement_end_date: new Date("2026-04-01T00:00:00.000Z") }),
        ]),
      },
    };
    const queueService = new RenewalDecisionService(db as any);
    const queue = await queueService.getOwnerRenewalQueue("owner-1", { now });
    expect(queue.renewals.map((row: any) => row.current_agreement.id)).toEqual(["critical", "expiring"]);
    expect(queue.counts).toMatchObject({ expiring: 1, expired: 1, overdue: 1, total: 2 });
  });

  it("returns agreement history newest version first", async () => {
    const db = {
      agreement: {
        findMany: vi.fn().mockResolvedValue([
          agreement({ id: "v2", agreement_version: 2, status: "SIGNED" }),
          agreement({ id: "v1", agreement_version: 1, status: "RENEWED" }),
        ]),
      },
    };
    const historyService = new RenewalDecisionService(db as any);
    const history = await historyService.getAgreementHistory({ tenantId: "tenant-1", ownerId: "owner-1" });
    expect(history.map((row: any) => row.id)).toEqual(["v2", "v1"]);
    expect(history[0].is_current).toBe(true);
    expect(history[1].is_historical).toBe(true);
  });
});
