import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateForAgreementInTx: vi.fn().mockResolvedValue({ created: 1, updated: 0, skipped: 0, months: [] }),
  registerEvent: vi.fn().mockResolvedValue({ id: "event-1" }),
}));

vi.mock("@/src/services/payments/agreement-rent-schedule-service", () => ({
  agreementRentScheduleService: { generateForAgreementInTx: mocks.generateForAgreementInTx },
}));

vi.mock("@/src/services/tenants/renewal-timeline-service", () => ({
  renewalTimelineService: { registerEvent: mocks.registerEvent },
}));

import {
  activateRenewal,
  RenewalActivationBlockedError,
  RenewalChainRaceError,
} from "@/src/services/tenants/renewal-activation-engine";

const completeLifecycle = {
  agreement_start_date: new Date("2027-06-14T00:00:00.000Z"),
  agreement_end_date: new Date("2028-06-14T00:00:00.000Z"),
  agreement_duration_months: 12,
  contract_rent: 8500,
  contract_security_deposit: 10000,
  contract_maintenance: 1400,
  contract_maintenance_type: "ONE_TIME",
  contract_payment_frequency: "MONTHLY",
};

function createTx(overrides: { predecessorUpdateCount?: number; successorUpdateCount?: number; moveOut?: any; unpaidDeposit?: any } = {}) {
  const queryRaw = vi.fn();
  const updateMany = vi.fn(async ({ where }: any) => {
    if (where.status && Array.isArray(where.status.in) && where.status.in.includes("SIGNED")) {
      return { count: overrides.predecessorUpdateCount ?? 1 };
    }
    return { count: overrides.successorUpdateCount ?? 1 };
  });
  const tenantsUpdate = vi.fn();
  const tx = {
    $queryRaw: queryRaw,
    agreement: { updateMany },
    tenants: { update: tenantsUpdate },
    move_out_requests: { findFirst: vi.fn().mockResolvedValue(overrides.moveOut ?? null) },
    rent_obligations: { findFirst: vi.fn().mockResolvedValue(overrides.unpaidDeposit ?? null) },
  };
  return { tx, queryRaw, updateMany, tenantsUpdate };
}

const predecessor = { id: "agreement-1", status: "SIGNED", renewed_to_agreement_id: "agreement-2" };
const successor = { id: "agreement-2", tenant_id: "tenant-1", hostel_id: "hostel-1", ...completeLifecycle };

describe("activateRenewal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("locks both rows, transitions predecessor to RENEWED and successor via the caller's payload", async () => {
    const { tx, queryRaw, updateMany } = createTx();
    const now = new Date("2027-06-14T00:00:00.000Z");
    const buildSuccessorUpdateData = vi.fn(() => ({ status: "SIGNED", signed_at: now, tenant_signature_url: "sig.png" }));

    await activateRenewal({
      tx,
      predecessor,
      successor,
      now,
      buildSuccessorUpdateData,
      tenantContractSync: null,
      timelineActor: { type: "SYSTEM" },
    });

    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "agreement-1", status: { in: ["SIGNED", "EXPIRING_SOON", "AGREEMENT_EXPIRED"] } },
      data: { status: "RENEWED", renewed_at: now },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "agreement-2", status: "DRAFT", renewed_from_agreement_id: "agreement-1" },
      data: { status: "SIGNED", signed_at: now, tenant_signature_url: "sig.png" },
    });
    expect(buildSuccessorUpdateData).toHaveBeenCalledTimes(1);
  });

  it("syncs tenant contract fields when tenantContractSync is provided", async () => {
    const { tx, tenantsUpdate } = createTx();
    await activateRenewal({
      tx,
      predecessor,
      successor,
      now: new Date(),
      timelineActor: { type: "SYSTEM" },
      buildSuccessorUpdateData: () => ({ status: "SIGNED" }),
      tenantContractSync: { monthly_rent: 8500, security_deposit: 10000, maintenance_charge: 1400, maintenance_type: "ONE_TIME" },
    });
    expect(tenantsUpdate).toHaveBeenCalledWith({
      where: { id: "tenant-1" },
      data: { monthly_rent: 8500, security_deposit: 10000, maintenance_charge: 1400, maintenance_type: "ONE_TIME" },
    });
  });

  it("skips tenant sync when tenantContractSync is null", async () => {
    const { tx, tenantsUpdate } = createTx();
    await activateRenewal({
      tx, predecessor, successor, now: new Date(),
      timelineActor: { type: "SYSTEM" },
      buildSuccessorUpdateData: () => ({ status: "SIGNED" }),
      tenantContractSync: null,
    });
    expect(tenantsUpdate).not.toHaveBeenCalled();
  });

  it("registers a RENEWAL_ACTIVATED timeline event using the caller-supplied actor", async () => {
    const { tx } = createTx();
    const now = new Date("2027-06-14T00:00:00.000Z");
    await activateRenewal({
      tx, predecessor, successor, now,
      timelineActor: { type: "OWNER", id: "owner-1" },
      buildSuccessorUpdateData: () => ({ status: "SIGNED" }),
      tenantContractSync: null,
    });

    expect(mocks.registerEvent).toHaveBeenCalledWith(tx, {
      hostelId: "hostel-1",
      tenantId: "tenant-1",
      agreementId: "agreement-2",
      eventType: "RENEWAL_ACTIVATED",
      actorType: "OWNER",
      actorId: "owner-1",
    });
  });

  it("does not register a timeline event when activation is blocked or races", async () => {
    const { tx } = createTx({ successorUpdateCount: 0 });
    await expect(
      activateRenewal({
        tx, predecessor, successor, now: new Date(),
        timelineActor: { type: "SYSTEM" },
        buildSuccessorUpdateData: () => ({ status: "SIGNED" }),
        tenantContractSync: null,
      })
    ).rejects.toBeInstanceOf(RenewalChainRaceError);
    expect(mocks.registerEvent).not.toHaveBeenCalled();
  });

  it("generates the rent schedule for the successor after activation", async () => {
    const { tx } = createTx();
    await activateRenewal({
      tx, predecessor, successor, now: new Date(),
      timelineActor: { type: "SYSTEM" },
      buildSuccessorUpdateData: () => ({ status: "SIGNED" }),
      tenantContractSync: null,
    });
    expect(mocks.generateForAgreementInTx).toHaveBeenCalledWith(tx, "agreement-2");
  });

  it("throws RenewalActivationBlockedError before any mutation when readiness fails", async () => {
    const { tx, updateMany, tenantsUpdate } = createTx({ moveOut: { id: "move-1", status: "REQUESTED" } });

    await expect(
      activateRenewal({
        tx, predecessor, successor, now: new Date(),
      timelineActor: { type: "SYSTEM" },
        buildSuccessorUpdateData: () => ({ status: "SIGNED" }),
        tenantContractSync: null,
      })
    ).rejects.toBeInstanceOf(RenewalActivationBlockedError);

    expect(updateMany).not.toHaveBeenCalled();
    expect(tenantsUpdate).not.toHaveBeenCalled();
    expect(mocks.generateForAgreementInTx).not.toHaveBeenCalled();
  });

  it("exposes all readiness failures on RenewalActivationBlockedError, not just the first", async () => {
    const badPredecessor = { ...predecessor, status: "TERMINATED", renewed_to_agreement_id: "someone-else" };
    const { tx } = createTx();

    try {
      await activateRenewal({
        tx, predecessor: badPredecessor, successor, now: new Date(),
      timelineActor: { type: "SYSTEM" },
        buildSuccessorUpdateData: () => ({ status: "SIGNED" }),
        tenantContractSync: null,
      });
      expect.fail("expected activateRenewal to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RenewalActivationBlockedError);
      expect((err as InstanceType<typeof RenewalActivationBlockedError>).failures.map((f) => f.code)).toEqual([
        "PREDECESSOR_NOT_RENEWABLE",
        "INVALID_RENEWAL_CHAIN",
      ]);
    }
  });

  it("throws RenewalChainRaceError(predecessor) when the predecessor updateMany count mismatches", async () => {
    const { tx } = createTx({ predecessorUpdateCount: 0 });

    try {
      await activateRenewal({
        tx, predecessor, successor, now: new Date(),
      timelineActor: { type: "SYSTEM" },
        buildSuccessorUpdateData: () => ({ status: "SIGNED" }),
        tenantContractSync: null,
      });
      expect.fail("expected activateRenewal to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RenewalChainRaceError);
      expect((err as InstanceType<typeof RenewalChainRaceError>).target).toBe("predecessor");
    }
  });

  it("throws RenewalChainRaceError(successor) when the successor updateMany count mismatches", async () => {
    const { tx } = createTx({ successorUpdateCount: 0 });

    try {
      await activateRenewal({
        tx, predecessor, successor, now: new Date(),
      timelineActor: { type: "SYSTEM" },
        buildSuccessorUpdateData: () => ({ status: "SIGNED" }),
        tenantContractSync: null,
      });
      expect.fail("expected activateRenewal to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RenewalChainRaceError);
      expect((err as InstanceType<typeof RenewalChainRaceError>).target).toBe("successor");
    }
  });

  it("does not sync tenant or generate rent schedule when the successor update races", async () => {
    const { tx, tenantsUpdate } = createTx({ successorUpdateCount: 0 });
    await expect(
      activateRenewal({
        tx, predecessor, successor, now: new Date(),
      timelineActor: { type: "SYSTEM" },
        buildSuccessorUpdateData: () => ({ status: "SIGNED" }),
        tenantContractSync: { monthly_rent: 1, security_deposit: 1, maintenance_charge: 1, maintenance_type: "MONTHLY" },
      })
    ).rejects.toBeInstanceOf(RenewalChainRaceError);
    expect(tenantsUpdate).not.toHaveBeenCalled();
    expect(mocks.generateForAgreementInTx).not.toHaveBeenCalled();
  });
});
