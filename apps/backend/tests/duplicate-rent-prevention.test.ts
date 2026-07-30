/**
 * P0 Regression Tests: Duplicate Rent Prevention
 *
 * Proves that the fix for the duplicate rent obligation bug works correctly
 * across all three scenarios identified in the forensic investigation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/preferences", () => ({
  resolvePreferences: vi.fn(() => ({ due_day: 5 })),
}));
// This suite exercises generateForAgreementInTx's own duplicate-detection
// logic against a hand-rolled tx mock — activation/credit-sweep is a
// separate concern (see obligation-activation.test.ts for integration
// coverage) and would require mocking the full settlement-engine query
// chain to exercise for real here, so it's mocked out as a no-op.
vi.mock("@/src/services/payments/financial-lifecycle-service", () => ({
  financialLifecycleService: {
    activatePayableObligations: vi.fn().mockResolvedValue([]),
    notifyActivated: vi.fn(),
  },
}));

import { AgreementRentScheduleService } from "@/src/services/payments/agreement-rent-schedule-service";

// ─── Test fixtures ──────────────────────────────────────────────────
const TENANT_ID = "tenant-1";
const OWNER_ID = "owner-1";
const HOSTEL_ID = "hostel-1";
const AGREEMENT_ID = "agreement-1";
const ALLOC_ID = "alloc-1";

const agreement = {
  id: AGREEMENT_ID,
  tenant_id: TENANT_ID,
  hostel_id: HOSTEL_ID,
  status: "SIGNED",
  agreement_duration_months: 3,
  agreement_start_date: new Date("2026-06-01T00:00:00.000Z"),
  contract_rent: 8500,
  tenant: {
    id: TENANT_ID,
    owner_id: OWNER_ID,
    hostel_id: HOSTEL_ID,
    monthly_rent: 8500,
    joined_on: new Date("2026-06-22T00:00:00.000Z"),
    room_allocations: [],  // No allocation yet at agreement signing time
  },
  hostel: { id: HOSTEL_ID, owner_id: OWNER_ID },
};

const agreementWithAllocation = {
  ...agreement,
  tenant: {
    ...agreement.tenant,
    room_allocations: [
      {
        id: ALLOC_ID,
        is_active: true,
        end_date: null,
        room: { base_rent: 8500, hostel_id: HOSTEL_ID },
      },
    ],
  },
};

/**
 * In-memory mock Prisma transaction that simulates the real findFirst behavior
 * including the new tenant_id-based dedup clause.
 */
function createTx(initialRows: any[] = []) {
  const rows: any[] = [...initialRows];
  return {
    rows,
    // Backs ObligationEngine.markObligationsPayableInTx's
    // `SELECT id, status FROM rent_obligations WHERE id = ANY(${ids}::uuid[])`
    // lock query — the tagged-template call passes the interpolated
    // obligationIds array as the mock's second argument.
    $queryRaw: vi.fn((_strings: TemplateStringsArray, ids: string[]) =>
      rows.filter((row) => ids?.includes(row.id)).map((row) => ({ id: row.id, status: row.status }))
    ),
    agreement: {
      findUnique: vi.fn(async () => agreement),
    },
    rent_obligations: {
      findFirst: vi.fn(async ({ where }: any) => {
        return rows.find((row) => {
          // Must match base filters
          if (where.is_superseded !== undefined && row.is_superseded !== where.is_superseded) return false;
          if (where.obligation_type && row.obligation_type !== where.obligation_type) return false;

          // Match OR clauses — this mirrors what Prisma does
          if (where.OR) {
            return where.OR.some((clause: any) => {
              const keys = Object.keys(clause);

              // tenant_id + rent_month clause (the P0 fix)
              if (keys.includes("tenant_id") && keys.includes("rent_month")) {
                return clause.tenant_id === row.tenant_id &&
                  clause.rent_month.getTime() === row.rent_month.getTime();
              }

              // agreement_id + rent_month clause
              if (keys.includes("agreement_id") && keys.includes("rent_month")) {
                return clause.agreement_id === row.agreement_id &&
                  clause.rent_month.getTime() === row.rent_month.getTime();
              }

              // allocation_id + rent_month clause
              if (keys.includes("allocation_id") && keys.includes("rent_month")) {
                return clause.allocation_id === row.allocation_id &&
                  clause.rent_month.getTime() === row.rent_month.getTime();
              }

              return false;
            });
          }
          return false;
        }) || null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `row-${rows.length + 1}`, payments: [], status: data.status, is_superseded: false, ...data };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const index = rows.findIndex((row) => row.id === where.id);
        if (index >= 0) rows[index] = { ...rows[index], ...data };
        return rows[index];
      }),
    },
  };
}

/**
 * Creates an onboarding-style RENT obligation (allocation_id=NULL, agreement_id=NULL)
 * exactly as OnboardingFinancialsService would create it.
 */
function onboardingRentObligation(rentMonth: Date): any {
  return {
    id: "onboarding-rent-1",
    tenant_id: TENANT_ID,
    allocation_id: null,
    agreement_id: null,
    owner_id: OWNER_ID,
    hostel_id: HOSTEL_ID,
    rent_month: rentMonth,
    amount: 8500,
    total_amount: 8500,
    due_date: new Date("2026-06-22T00:00:00.000Z"),
    status: "PENDING",
    obligation_type: "RENT",
    is_superseded: false,
    installment_label: "Rent – Jun 2026",
    payments: [],
  };
}

// ─── Test Suite ─────────────────────────────────────────────────────

describe("P0 Duplicate Rent Prevention", () => {
  let service: AgreementRentScheduleService;

  beforeEach(() => {
    service = new AgreementRentScheduleService();
  });

  // ═══════════════════════════════════════════════════════════════════
  // CASE 1: Onboarding RENT exists → Agreement signing must NOT create duplicate
  // ═══════════════════════════════════════════════════════════════════
  describe("Case 1: Onboarding rent exists, then agreement is signed", () => {
    it("should detect the onboarding obligation and update it instead of creating a duplicate", async () => {
      // Simulate: OnboardingFinancialsService already created a June RENT
      const existingOnboardingRent = onboardingRentObligation(
        new Date("2026-06-01T00:00:00.000Z")
      );
      const tx = createTx([existingOnboardingRent]);

      // Now AgreementRentScheduleService runs during signAgreement()
      const result = await service.generateForAgreementInTx(tx as any, AGREEMENT_ID, {
        now: new Date("2026-06-22T00:00:00.000Z"),
      });

      // June obligation should be UPDATED (adopted), not duplicated
      const juneRents = tx.rows.filter(
        (r) => r.obligation_type === "RENT" &&
          r.rent_month.getTime() === new Date("2026-06-01T00:00:00.000Z").getTime() &&
          !r.is_superseded
      );

      expect(juneRents).toHaveLength(1);
      expect(juneRents[0].agreement_id).toBe(AGREEMENT_ID); // adopted by agreement
      expect(result.updated).toBeGreaterThanOrEqual(1);
    });

    it("should still create obligations for other months in the agreement", async () => {
      const existingOnboardingRent = onboardingRentObligation(
        new Date("2026-06-01T00:00:00.000Z")
      );
      const tx = createTx([existingOnboardingRent]);

      const result = await service.generateForAgreementInTx(tx as any, AGREEMENT_ID, {
        now: new Date("2026-06-22T00:00:00.000Z"),
      });

      // June = updated, July + Aug = created
      expect(result.created).toBe(2);
      expect(result.updated).toBe(1);
      expect(tx.rows).toHaveLength(3); // 1 original (updated) + 2 new
    });

    it("should ensure exactly ONE active RENT per month across all months", async () => {
      const existingOnboardingRent = onboardingRentObligation(
        new Date("2026-06-01T00:00:00.000Z")
      );
      const tx = createTx([existingOnboardingRent]);

      await service.generateForAgreementInTx(tx as any, AGREEMENT_ID, {
        now: new Date("2026-06-22T00:00:00.000Z"),
      });

      const activeRents = tx.rows.filter(
        (r) => r.obligation_type === "RENT" && !r.is_superseded
      );

      // Should have exactly 3: Jun (updated), Jul (new), Aug (new)
      expect(activeRents).toHaveLength(3);
      const months = activeRents.map((r) => r.rent_month.toISOString().slice(0, 7)).sort();
      expect(months).toEqual(["2026-06", "2026-07", "2026-08"]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CASE 2: Agreement RENT exists → Generator reruns → No duplicates
  // ═══════════════════════════════════════════════════════════════════
  describe("Case 2: Agreement rent exists, generator reruns", () => {
    it("should not create duplicates when the schedule is regenerated", async () => {
      const tx = createTx();

      // First run: creates all 3 months
      const first = await service.generateForAgreementInTx(tx as any, AGREEMENT_ID, {
        now: new Date("2026-06-22T00:00:00.000Z"),
      });
      expect(first.created).toBe(3);

      // Second run: should update existing, not create new
      const second = await service.generateForAgreementInTx(tx as any, AGREEMENT_ID, {
        now: new Date("2026-06-22T00:00:00.000Z"),
      });
      expect(second.created).toBe(0);
      expect(second.updated).toBe(3);
      expect(tx.rows).toHaveLength(3);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CASE 3: Onboarding obligation with NULL identifiers is properly
  //         detected by the tenant_id clause
  // ═══════════════════════════════════════════════════════════════════
  describe("Case 3: Onboarding obligation detection via tenant_id", () => {
    it("findFirst query includes tenant_id in OR clause", async () => {
      const existingOnboardingRent = onboardingRentObligation(
        new Date("2026-06-01T00:00:00.000Z")
      );
      const tx = createTx([existingOnboardingRent]);

      await service.generateForAgreementInTx(tx as any, AGREEMENT_ID, {
        now: new Date("2026-06-22T00:00:00.000Z"),
      });

      // Verify that findFirst was called with the tenant_id clause
      const findFirstCalls = tx.rent_obligations.findFirst.mock.calls;

      // Find the call for June rent_month
      const juneCall = findFirstCalls.find((call: any) => {
        const where = call[0]?.where;
        return where?.OR?.some((clause: any) =>
          clause.rent_month?.getTime() === new Date("2026-06-01T00:00:00.000Z").getTime()
        );
      });

      expect(juneCall).toBeDefined();
      const orClauses = juneCall![0].where.OR;

      // Must have a tenant_id clause
      const hasTenantClause = orClauses.some(
        (clause: any) => clause.tenant_id === TENANT_ID
      );
      expect(hasTenantClause).toBe(true);
    });

    it("should not detect a superseded obligation as a duplicate", async () => {
      // Superseded obligations should be ignored
      const supersededObligation = {
        ...onboardingRentObligation(new Date("2026-06-01T00:00:00.000Z")),
        is_superseded: true,
      };
      const tx = createTx([supersededObligation]);

      const result = await service.generateForAgreementInTx(tx as any, AGREEMENT_ID, {
        now: new Date("2026-06-22T00:00:00.000Z"),
      });

      // All 3 months should be created fresh (superseded one is invisible)
      expect(result.created).toBe(3);
    });

    it("should not detect a different tenant's obligation as a duplicate", async () => {
      const otherTenantObligation = {
        ...onboardingRentObligation(new Date("2026-06-01T00:00:00.000Z")),
        tenant_id: "other-tenant-id",
      };
      const tx = createTx([otherTenantObligation]);

      const result = await service.generateForAgreementInTx(tx as any, AGREEMENT_ID, {
        now: new Date("2026-06-22T00:00:00.000Z"),
      });

      // All 3 months should be created (other tenant's obligation is irrelevant)
      expect(result.created).toBe(3);
      expect(tx.rows).toHaveLength(4); // 1 other tenant + 3 new
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // CASE 4: Adoption — onboarding obligation gets enriched with agreement_id
  // ═══════════════════════════════════════════════════════════════════
  describe("Case 4: Onboarding obligation adoption", () => {
    it("should link the onboarding obligation to the agreement", async () => {
      const existingOnboardingRent = onboardingRentObligation(
        new Date("2026-06-01T00:00:00.000Z")
      );
      const tx = createTx([existingOnboardingRent]);

      await service.generateForAgreementInTx(tx as any, AGREEMENT_ID, {
        now: new Date("2026-06-22T00:00:00.000Z"),
      });

      // The update call should set agreement_id
      const updateCalls = tx.rent_obligations.update.mock.calls;
      const juneUpdate = updateCalls.find(
        (call: any) => call[0].where.id === "onboarding-rent-1"
      );
      expect(juneUpdate).toBeDefined();
      expect(juneUpdate![0].data.agreement_id).toBe(AGREEMENT_ID);
    });
  });
});
