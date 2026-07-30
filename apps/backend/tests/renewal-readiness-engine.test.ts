import { describe, expect, it, vi } from "vitest";
import {
  checkPredecessorRenewable,
  checkChainConsistent,
  checkNoActiveMoveOut,
  checkLifecycleComplete,
  checkNoUnpaidDeposit,
  checkNoExistingSuccessor,
  evaluateActivationReadiness,
  evaluateCreationReadiness,
} from "@/src/services/tenants/renewal-readiness-engine";

const completeLifecycle = {
  agreement_start_date: new Date("2026-06-14T00:00:00.000Z"),
  agreement_end_date: new Date("2027-06-14T00:00:00.000Z"),
  agreement_duration_months: 12,
  contract_rent: 8500,
  contract_security_deposit: 10000,
  contract_maintenance: 1400,
  contract_maintenance_type: "ONE_TIME",
  contract_payment_frequency: "MONTHLY",
};

describe("checkPredecessorRenewable", () => {
  it.each(["SIGNED", "EXPIRING_SOON", "AGREEMENT_EXPIRED"])("returns null for renewable status %s", (status) => {
    expect(checkPredecessorRenewable({ id: "agreement-1", status })).toBeNull();
  });

  it.each(["DRAFT", "RENEWED", "TERMINATED", "VOID"])("returns a failure for non-renewable status %s", (status) => {
    const failure = checkPredecessorRenewable({ id: "agreement-1", status });
    expect(failure).toMatchObject({
      code: "PREDECESSOR_NOT_RENEWABLE",
      details: { predecessorAgreementId: "agreement-1", predecessorStatus: status },
    });
  });
});

describe("checkChainConsistent", () => {
  it("returns null when the predecessor's renewed_to_agreement_id matches the successor", () => {
    expect(
      checkChainConsistent({ id: "agreement-1", renewed_to_agreement_id: "agreement-2" }, "agreement-2")
    ).toBeNull();
  });

  it("returns a failure when the chain is broken", () => {
    const failure = checkChainConsistent(
      { id: "agreement-1", renewed_to_agreement_id: "agreement-99" },
      "agreement-2"
    );
    expect(failure).toMatchObject({
      code: "INVALID_RENEWAL_CHAIN",
      details: {
        predecessorAgreementId: "agreement-1",
        predecessorRenewedToAgreementId: "agreement-99",
        successorAgreementId: "agreement-2",
      },
    });
  });

  it("returns a failure when renewed_to_agreement_id is null", () => {
    const failure = checkChainConsistent({ id: "agreement-1", renewed_to_agreement_id: null }, "agreement-2");
    expect(failure?.code).toBe("INVALID_RENEWAL_CHAIN");
  });
});

describe("checkNoActiveMoveOut", () => {
  it("returns null when no active move-out exists", async () => {
    const tx = { move_out_requests: { findFirst: vi.fn().mockResolvedValue(null) } };
    const failure = await checkNoActiveMoveOut(tx, "tenant-1");
    expect(failure).toBeNull();
    expect(tx.move_out_requests.findFirst).toHaveBeenCalledWith({
      where: { tenant_id: "tenant-1", status: { notIn: ["COMPLETED", "REJECTED"] } },
      select: { id: true, status: true },
      orderBy: { created_at: "desc" },
    });
  });

  it("returns a failure when an active move-out exists", async () => {
    const tx = {
      move_out_requests: {
        findFirst: vi.fn().mockResolvedValue({ id: "move-1", status: "REQUESTED" }),
      },
    };
    const failure = await checkNoActiveMoveOut(tx, "tenant-1");
    expect(failure).toMatchObject({
      code: "MOVE_OUT_IN_PROGRESS",
      details: { tenantId: "tenant-1", moveOutRequestId: "move-1", moveOutStatus: "REQUESTED" },
    });
  });
});

describe("checkLifecycleComplete", () => {
  it("returns null when the agreement/candidate has all required fields", () => {
    expect(checkLifecycleComplete(completeLifecycle, "agreement-1")).toBeNull();
  });

  it("returns a failure listing missing fields", () => {
    const failure = checkLifecycleComplete({ ...completeLifecycle, agreement_end_date: null }, "agreement-1");
    expect(failure).toMatchObject({
      code: "AGREEMENT_LIFECYCLE_INCOMPLETE",
      details: expect.objectContaining({
        agreementId: "agreement-1",
        missingFields: expect.arrayContaining(["agreement_end_date"]),
      }),
    });
  });
});

describe("checkNoUnpaidDeposit", () => {
  it("returns null when no unpaid deposit obligation exists", async () => {
    const tx = { rent_obligations: { findFirst: vi.fn().mockResolvedValue(null) } };
    const failure = await checkNoUnpaidDeposit(tx, "agreement-2");
    expect(failure).toBeNull();
    expect(tx.rent_obligations.findFirst).toHaveBeenCalledWith({
      where: {
        agreement_id: "agreement-2",
        obligation_type: "SECURITY_DEPOSIT",
        status: { in: ["PENDING", "PARTIAL"] },
        is_superseded: false,
      },
    });
  });

  it("returns a failure when an unpaid deposit obligation exists", async () => {
    const tx = {
      rent_obligations: {
        findFirst: vi.fn().mockResolvedValue({ id: "ob-1", amount: 500 }),
      },
    };
    const failure = await checkNoUnpaidDeposit(tx, "agreement-2");
    expect(failure).toMatchObject({
      code: "SECURITY_DEPOSIT_UNPAID",
      details: { agreementId: "agreement-2", obligationId: "ob-1", amount: 500 },
    });
  });
});

describe("checkNoExistingSuccessor", () => {
  it("returns null when there is no successor", () => {
    expect(
      checkNoExistingSuccessor({ id: "agreement-1", renewed_to_agreement: null, renewed_agreements: [] })
    ).toBeNull();
  });

  it("returns a failure using renewed_to_agreement when present", () => {
    const failure = checkNoExistingSuccessor({
      id: "agreement-1",
      renewed_to_agreement: { id: "agreement-2", status: "DRAFT" },
      renewed_agreements: [],
    });
    expect(failure).toMatchObject({
      code: "AGREEMENT_SUCCESSOR_EXISTS",
      details: { sourceAgreementId: "agreement-1", successorAgreementId: "agreement-2", successorStatus: "DRAFT" },
    });
  });

  it("falls back to renewed_agreements[0] when renewed_to_agreement is absent", () => {
    const failure = checkNoExistingSuccessor({
      id: "agreement-1",
      renewed_to_agreement: null,
      renewed_agreements: [{ id: "agreement-3", status: "SIGNED" }],
    });
    expect(failure).toMatchObject({
      code: "AGREEMENT_SUCCESSOR_EXISTS",
      details: { successorAgreementId: "agreement-3", successorStatus: "SIGNED" },
    });
  });
});

describe("evaluateActivationReadiness", () => {
  const predecessor = { id: "agreement-1", status: "SIGNED", renewed_to_agreement_id: "agreement-2" };
  const successor = { id: "agreement-2", tenant_id: "tenant-1", ...completeLifecycle };

  function tx(overrides: { moveOut?: any; unpaidDeposit?: any } = {}) {
    return {
      move_out_requests: { findFirst: vi.fn().mockResolvedValue(overrides.moveOut ?? null) },
      rent_obligations: { findFirst: vi.fn().mockResolvedValue(overrides.unpaidDeposit ?? null) },
    };
  }

  it("is ready when every check passes", async () => {
    const result = await evaluateActivationReadiness(tx(), { predecessor, successor });
    expect(result).toEqual({ ready: true, failures: [] });
  });

  it("collects every failing check, not just the first", async () => {
    const badPredecessor = { ...predecessor, status: "TERMINATED", renewed_to_agreement_id: "someone-else" };
    const result = await evaluateActivationReadiness(
      tx({ moveOut: { id: "move-1", status: "REQUESTED" } }),
      { predecessor: badPredecessor, successor }
    );
    expect(result.ready).toBe(false);
    expect(result.failures.map((f) => f.code)).toEqual([
      "PREDECESSOR_NOT_RENEWABLE",
      "INVALID_RENEWAL_CHAIN",
      "MOVE_OUT_IN_PROGRESS",
    ]);
  });

  it("runs checks in canonical order: renewable, chain, lifecycle, move-out, deposit", async () => {
    // Only the deposit check fails - confirms it runs, and confirms the
    // order doesn't short-circuit before reaching it.
    const result = await evaluateActivationReadiness(
      tx({ unpaidDeposit: { id: "ob-1", amount: 500 } }),
      { predecessor, successor }
    );
    expect(result.failures.map((f) => f.code)).toEqual(["SECURITY_DEPOSIT_UNPAID"]);
  });
});

describe("evaluateCreationReadiness", () => {
  const sourceAgreement = {
    id: "agreement-1",
    status: "SIGNED",
    renewed_to_agreement: null,
    renewed_agreements: [],
  };

  function tx(overrides: { moveOut?: any } = {}) {
    return {
      move_out_requests: { findFirst: vi.fn().mockResolvedValue(overrides.moveOut ?? null) },
    };
  }

  it("is ready when every check passes", async () => {
    const result = await evaluateCreationReadiness(tx(), {
      sourceAgreement,
      lifecycleCandidate: completeLifecycle,
    });
    expect(result).toEqual({ ready: true, failures: [] });
  });

  it("runs checks in order: renewable, successor-exists, move-out, lifecycle-complete", async () => {
    const result = await evaluateCreationReadiness(
      tx({ moveOut: { id: "move-1", status: "REQUESTED" } }),
      {
        sourceAgreement: {
          ...sourceAgreement,
          status: "VOID",
          renewed_to_agreement: { id: "agreement-2", status: "DRAFT" },
        },
        lifecycleCandidate: { ...completeLifecycle, agreement_end_date: null },
      }
    );
    expect(result.failures.map((f) => f.code)).toEqual([
      "PREDECESSOR_NOT_RENEWABLE",
      "AGREEMENT_SUCCESSOR_EXISTS",
      "MOVE_OUT_IN_PROGRESS",
      "AGREEMENT_LIFECYCLE_INCOMPLETE",
    ]);
  });

  it("does not run the chain-consistency or deposit checks (not applicable pre-creation)", async () => {
    // Sanity check on scope: creation readiness never queries rent_obligations
    // at all, since no successor/deposit obligation can exist yet.
    const txSpy = tx();
    (txSpy as any).rent_obligations = { findFirst: vi.fn() };
    await evaluateCreationReadiness(txSpy, { sourceAgreement, lifecycleCandidate: completeLifecycle });
    expect((txSpy as any).rent_obligations.findFirst).not.toHaveBeenCalled();
  });
});
