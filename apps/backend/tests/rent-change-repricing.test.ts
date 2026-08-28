import { describe, expect, it } from "vitest";
import { applyRentChangeInTx } from "@/src/services/payments/rent-change-service";

/**
 * Changing a tenant's rent, without the agreement system.
 *
 * Rent used to be anchored to the `Agreement` row: the service took an
 * `agreementId`, read the old rent from `contract_rent`, and the route 404'd
 * when no suitable agreement existed. But an agreement is optional by design —
 * `tenant_rules.agreement_required` (ADR-059) lets an owner turn the whole
 * ceremony off, and then no signed agreement ever exists. Anchoring money to
 * an optional record meant rent was unchangeable for those hostels.
 *
 * `tenants.monthly_rent` is the real source of truth, and the rest of the
 * codebase already treats it that way — every reader of `contract_rent` falls
 * back to it (`agreement?.contract_rent ?? monthly_rent`). So the tenant is the
 * anchor here, and the agreement is a snapshot kept in step when one happens to
 * exist.
 */

const TENANT_ID = "tenant-1";
const HOSTEL_ID = "hostel-1";
const AGREEMENT_ID = "agr-1";

interface StubObligation {
  id: string;
  agreement_id: string | null;
  tenant_id: string;
  hostel_id?: string | null;
  payments?: Array<{ id: string }>;
}

interface StubOptions {
  obligations?: StubObligation[];
  /** null = this tenant has no agreement at all, which must still work. */
  agreement?: { id: string; status: string } | null;
  tenantHostelId?: string;
  monthlyRent?: number;
}

function stubTx({
  obligations = [],
  agreement = null,
  tenantHostelId = HOSTEL_ID,
  monthlyRent = 8000,
}: StubOptions = {}) {
  const updatedIds: string[] = [];
  const agreementUpdates: any[] = [];
  const tenantUpdates: any[] = [];
  let capturedWhere: any = null;
  let agreementQuery: any = null;

  const matches = (ob: StubObligation, where: any): boolean => {
    if (where.tenant_id !== undefined && ob.tenant_id !== where.tenant_id) return false;
    if (where.hostel_id !== undefined && (ob.hostel_id ?? null) !== where.hostel_id) return false;
    return true;
  };

  const tx = {
    $queryRaw: async () => [{ id: TENANT_ID }],
    tenants: {
      findUniqueOrThrow: async () => ({
        id: TENANT_ID,
        hostel_id: tenantHostelId,
        monthly_rent: monthlyRent,
      }),
      update: async (args: any) => {
        tenantUpdates.push(args);
        return args;
      },
    },
    agreement: {
      findFirst: async (args: any) => {
        agreementQuery = args;
        return agreement;
      },
      update: async (args: any) => {
        agreementUpdates.push(args);
        return args;
      },
    },
    rent_obligations: {
      findMany: async (args: any) => {
        capturedWhere = args.where;
        return obligations.filter((ob) => matches(ob, args.where));
      },
      update: async (args: any) => {
        updatedIds.push(args.where.id);
        return args;
      },
    },
  };

  return {
    tx,
    updatedIds,
    agreementUpdates,
    tenantUpdates,
    where: () => capturedWhere,
    agreementQuery: () => agreementQuery,
  };
}

const params = {
  tenantId: TENANT_ID,
  hostelId: HOSTEL_ID,
  newRentAmount: 9500,
  effectiveFromMonth: new Date("2026-09-01T00:00:00.000Z"),
  actorId: "owner-1",
  reason: "Annual revision",
};

describe("applyRentChangeInTx — with no agreement system involved", () => {
  it("changes rent for a tenant who has no agreement at all", async () => {
    const s = stubTx({ agreement: null });
    const result = await applyRentChangeInTx(s.tx, params);
    expect(s.tenantUpdates[0].data).toEqual({ monthly_rent: 9500 });
    expect(result.newRentAmount).toBe(9500);
    expect(result.agreementId).toBeNull();
  });

  it("takes the old rent from the tenant, not from a contract", async () => {
    const s = stubTx({ agreement: null, monthlyRent: 7200 });
    const result = await applyRentChangeInTx(s.tx, params);
    expect(result.oldRentAmount).toBe(7200);
  });

  it("reprices a tenant's unpaid charges with no agreement in play", async () => {
    const s = stubTx({
      agreement: null,
      obligations: [{ id: "ob-1", agreement_id: null, tenant_id: TENANT_ID, hostel_id: HOSTEL_ID }],
    });
    const result = await applyRentChangeInTx(s.tx, params);
    expect(s.updatedIds).toEqual(["ob-1"]);
    expect(result.obligationsUpdated).toBe(1);
  });

  it("reprices linked and unlinked charges alike — the link is irrelevant now", async () => {
    const s = stubTx({
      agreement: null,
      obligations: [
        { id: "ob-linked", agreement_id: AGREEMENT_ID, tenant_id: TENANT_ID, hostel_id: HOSTEL_ID },
        { id: "ob-cron", agreement_id: null, tenant_id: TENANT_ID, hostel_id: HOSTEL_ID },
      ],
    });
    await applyRentChangeInTx(s.tx, params);
    expect(s.updatedIds.sort()).toEqual(["ob-cron", "ob-linked"]);
  });

  it("never selects obligations by agreement", async () => {
    const s = stubTx({ agreement: null });
    await applyRentChangeInTx(s.tx, params);
    expect(s.where()).not.toHaveProperty("agreement_id");
    expect(s.where()).not.toHaveProperty("OR");
  });
});

describe("applyRentChangeInTx — the agreement as a snapshot, when one exists", () => {
  it("keeps a live agreement's contract_rent in step", async () => {
    // Every reader does `agreement?.contract_rent ?? monthly_rent`, preferring
    // the agreement's copy when there is one. Leaving it stale would make
    // renewals and settlement quote the old rent.
    const s = stubTx({ agreement: { id: AGREEMENT_ID, status: "SIGNED" } });
    const result = await applyRentChangeInTx(s.tx, params);
    expect(s.agreementUpdates[0].data).toEqual({ contract_rent: 9500 });
    expect(result.agreementId).toBe(AGREEMENT_ID);
  });

  it("keeps an unsigned draft in step too", async () => {
    const s = stubTx({ agreement: { id: AGREEMENT_ID, status: "DRAFT" } });
    await applyRentChangeInTx(s.tx, params);
    expect(s.agreementUpdates[0].data).toEqual({ contract_rent: 9500 });
  });

  it("touches no agreement when the tenant has none", async () => {
    const s = stubTx({ agreement: null });
    await applyRentChangeInTx(s.tx, params);
    expect(s.agreementUpdates).toEqual([]);
  });

  it("looks only for an agreement whose rent may still change", async () => {
    // RENEWED and TERMINATED are excluded: a later agreement governs, or none
    // does, and rewriting a closed contract's rent would falsify history.
    const s = stubTx({ agreement: null });
    await applyRentChangeInTx(s.tx, params);
    const statuses = s.agreementQuery()?.where?.status?.in ?? [];
    expect(statuses).toContain("DRAFT");
    expect(statuses).toContain("SIGNED");
    expect(statuses).not.toContain("RENEWED");
    expect(statuses).not.toContain("TERMINATED");
  });

  it("scopes the agreement lookup to this tenant and hostel", async () => {
    const s = stubTx({ agreement: null });
    await applyRentChangeInTx(s.tx, params);
    expect(s.agreementQuery()?.where).toMatchObject({
      tenant_id: TENANT_ID,
      hostel_id: HOSTEL_ID,
    });
  });
});

describe("applyRentChangeInTx — guards", () => {
  it("refuses a tenant who does not belong to the given hostel", async () => {
    // The agreement's hostel used to be what proved this. With the agreement
    // gone, the tenant's own hostel is the only check left, so it must exist.
    const s = stubTx({ tenantHostelId: "hostel-2" });
    await expect(applyRentChangeInTx(s.tx, params)).rejects.toThrow(/hostel/i);
    expect(s.tenantUpdates).toEqual([]);
  });

  it("never reprices another tenant's charges", async () => {
    const s = stubTx({
      obligations: [{ id: "ob-other", agreement_id: null, tenant_id: "tenant-2", hostel_id: HOSTEL_ID }],
    });
    await applyRentChangeInTx(s.tx, params);
    expect(s.updatedIds).toEqual([]);
  });

  it("never reprices charges from a hostel this tenant has left", async () => {
    const s = stubTx({
      obligations: [{ id: "ob-old-hostel", agreement_id: null, tenant_id: TENANT_ID, hostel_id: "hostel-2" }],
    });
    await applyRentChangeInTx(s.tx, params);
    expect(s.updatedIds).toEqual([]);
  });

  it("still refuses to reprice a charge that has a payment against it", async () => {
    const s = stubTx({
      obligations: [
        { id: "ob-paid", agreement_id: null, tenant_id: TENANT_ID, hostel_id: HOSTEL_ID, payments: [{ id: "p1" }] },
      ],
    });
    const result = await applyRentChangeInTx(s.tx, params);
    expect(s.updatedIds).toEqual([]);
    expect(result.obligationsUpdated).toBe(0);
  });

  it("keeps the month, lifecycle and settlement guards", async () => {
    const s = stubTx();
    await applyRentChangeInTx(s.tx, params);
    const where = s.where();
    expect(where.obligation_type).toBe("RENT");
    expect(where.is_superseded).toBe(false);
    expect(where.lifecycle_status).toBe("ACTIVE");
    expect(where.settlement_status).toBe("UNPAID");
    expect(where.rent_month).toEqual({ gte: params.effectiveFromMonth });
  });

  it("rejects a non-positive rent", async () => {
    const s = stubTx();
    await expect(
      applyRentChangeInTx(s.tx, { ...params, newRentAmount: 0 }),
    ).rejects.toThrow(/VALIDATION_ERROR/);
  });

  it("rejects a missing reason", async () => {
    const s = stubTx();
    await expect(
      applyRentChangeInTx(s.tx, { ...params, reason: "   " }),
    ).rejects.toThrow(/VALIDATION_ERROR/);
  });
});
