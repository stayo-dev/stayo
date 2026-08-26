import { describe, expect, it } from "vitest";
import { applyRentChangeInTx } from "@/src/services/payments/rent-change-service";

/**
 * Which unpaid obligations a rent change reprices.
 *
 * The selector matched `agreement_id: agreementId` alone. Two generation paths
 * write rent obligations and only one of them sets that column:
 *
 *  - `agreement-rent-schedule-service` fires when an agreement is **signed**
 *    and writes the whole installment schedule with `agreement_id` set.
 *  - `rentGenerationService.generateMonthlyRent` — the monthly cron — writes
 *    `rentRows`/`maintRows` with **no `agreement_id` field at all**.
 *
 * A hostel with `agreement_required = false` (ADR-059) never signs, so its
 * tenants are fed entirely by the cron and every obligation they have is
 * unlinked. Changing their rent updated the contract and `tenants.monthly_rent`
 * — so future months were right — while every already-generated unpaid
 * obligation silently kept the old amount.
 */

const AGREEMENT_ID = "agr-1";
const TENANT_ID = "tenant-1";
const HOSTEL_ID = "hostel-1";

interface StubObligation {
  id: string;
  agreement_id: string | null;
  tenant_id: string;
  hostel_id?: string | null;
  payments?: Array<{ id: string }>;
}

/**
 * A transaction stand-in. Records the `where` the service builds and answers
 * with whichever fixtures satisfy it, so the test exercises the real selector
 * rather than asserting on a mock's call arguments.
 */
function stubTx(obligations: StubObligation[]) {
  const updatedIds: string[] = [];
  const agreementUpdates: any[] = [];
  const tenantUpdates: any[] = [];
  let capturedWhere: any = null;

  const matches = (ob: StubObligation, where: any): boolean => {
    if (where.OR) return where.OR.some((clause: any) => matches(ob, { ...where, OR: undefined, ...clause }));
    if (where.agreement_id !== undefined) {
      if (where.agreement_id === null) {
        if (ob.agreement_id !== null) return false;
      } else if (ob.agreement_id !== where.agreement_id) {
        return false;
      }
    }
    if (where.tenant_id !== undefined && ob.tenant_id !== where.tenant_id) return false;
    if (where.hostel_id !== undefined && (ob.hostel_id ?? null) !== where.hostel_id) return false;
    return true;
  };

  const tx = {
    $queryRaw: async () => [{ id: AGREEMENT_ID }],
    agreement: {
      findUniqueOrThrow: async () => ({
        id: AGREEMENT_ID,
        tenant_id: TENANT_ID,
        hostel_id: HOSTEL_ID,
        contract_rent: 8000,
      }),
      update: async (args: any) => {
        agreementUpdates.push(args);
        return args;
      },
    },
    tenants: {
      update: async (args: any) => {
        tenantUpdates.push(args);
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
  };
}

const params = {
  agreementId: AGREEMENT_ID,
  hostelId: HOSTEL_ID,
  newRentAmount: 9500,
  effectiveFromMonth: new Date("2026-09-01T00:00:00.000Z"),
  actorId: "owner-1",
  reason: "Annual revision",
};

describe("applyRentChangeInTx — which obligations get repriced", () => {
  it("reprices obligations linked to the agreement", async () => {
    const s = stubTx([{ id: "ob-linked", agreement_id: AGREEMENT_ID, tenant_id: TENANT_ID }]);
    const result = await applyRentChangeInTx(s.tx, params);
    expect(s.updatedIds).toEqual(["ob-linked"]);
    expect(result.obligationsUpdated).toBe(1);
  });

  it("reprices the tenant's unlinked obligations — the cron-generated ones", async () => {
    const s = stubTx([{ id: "ob-cron", agreement_id: null, tenant_id: TENANT_ID, hostel_id: HOSTEL_ID }]);
    const result = await applyRentChangeInTx(s.tx, params);
    expect(s.updatedIds).toEqual(["ob-cron"]);
    expect(result.obligationsUpdated).toBe(1);
  });

  it("reprices both kinds together for a tenant who has each", async () => {
    const s = stubTx([
      { id: "ob-linked", agreement_id: AGREEMENT_ID, tenant_id: TENANT_ID },
      { id: "ob-cron", agreement_id: null, tenant_id: TENANT_ID, hostel_id: HOSTEL_ID },
    ]);
    await applyRentChangeInTx(s.tx, params);
    expect(s.updatedIds.sort()).toEqual(["ob-cron", "ob-linked"]);
  });

  it("never reprices an unlinked obligation belonging to a different tenant", async () => {
    // The whole risk of widening the selector. An unlinked row carries no
    // agreement, so tenant identity is the only thing keeping one tenant's
    // rent change out of another's charges.
    const s = stubTx([{ id: "ob-other-tenant", agreement_id: null, tenant_id: "tenant-2", hostel_id: HOSTEL_ID }]);
    const result = await applyRentChangeInTx(s.tx, params);
    expect(s.updatedIds).toEqual([]);
    expect(result.obligationsUpdated).toBe(0);
  });

  it("never reprices an unlinked obligation from another hostel", async () => {
    const s = stubTx([
      { id: "ob-other-hostel", agreement_id: null, tenant_id: TENANT_ID, hostel_id: "hostel-2" },
    ]);
    await applyRentChangeInTx(s.tx, params);
    expect(s.updatedIds).toEqual([]);
  });

  it("skips an unlinked obligation with no hostel recorded rather than guessing", async () => {
    // A legacy row predating the immutable-hostel-context change carries no
    // hostel. Skipping it under-reprices; matching it could write to another
    // hostel's money. For a rent change, under-reprice is the safe direction.
    const s = stubTx([
      { id: "ob-no-hostel", agreement_id: null, tenant_id: TENANT_ID, hostel_id: null },
    ]);
    await applyRentChangeInTx(s.tx, params);
    expect(s.updatedIds).toEqual([]);
  });

  it("never reprices an obligation linked to a different agreement", async () => {
    const s = stubTx([{ id: "ob-other-agreement", agreement_id: "agr-2", tenant_id: TENANT_ID }]);
    await applyRentChangeInTx(s.tx, params);
    expect(s.updatedIds).toEqual([]);
  });

  it("still refuses to reprice an obligation that has a payment against it", async () => {
    const s = stubTx([
      { id: "ob-paid", agreement_id: null, tenant_id: TENANT_ID, hostel_id: HOSTEL_ID, payments: [{ id: "p1" }] },
    ]);
    const result = await applyRentChangeInTx(s.tx, params);
    expect(s.updatedIds).toEqual([]);
    expect(result.obligationsUpdated).toBe(0);
  });

  it("keeps the month, lifecycle and settlement guards on the selector", async () => {
    const s = stubTx([]);
    await applyRentChangeInTx(s.tx, params);
    const where = s.where();
    expect(where.obligation_type).toBe("RENT");
    expect(where.is_superseded).toBe(false);
    expect(where.lifecycle_status).toBe("ACTIVE");
    expect(where.settlement_status).toBe("UNPAID");
    expect(where.rent_month).toEqual({ gte: params.effectiveFromMonth });
  });

  it("still syncs the contract and the tenant's rent regardless of what is repriced", async () => {
    const s = stubTx([]);
    await applyRentChangeInTx(s.tx, params);
    expect(s.agreementUpdates[0].data).toEqual({ contract_rent: 9500 });
    expect(s.tenantUpdates[0].data).toEqual({ monthly_rent: 9500 });
  });
});
