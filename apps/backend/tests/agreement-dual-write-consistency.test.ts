import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/preferences", () => ({
  resolvePreferences: vi.fn(() => ({ due_day: 5 })),
}));
vi.mock("@/src/services/payments/financial-lifecycle-service", () => ({
  financialLifecycleService: {
    activatePayableObligations: vi.fn().mockResolvedValue([]),
    notifyActivated: vi.fn(),
  },
}));

import { AgreementRentScheduleService } from "@/src/services/payments/agreement-rent-schedule-service";
import { fromLegacyStatus } from "@/src/services/payments/financial-obligation.types";

const agreement = {
  id: "agreement-1",
  tenant_id: "tenant-1",
  hostel_id: "hostel-1",
  status: "SIGNED",
  agreement_duration_months: 2,
  agreement_start_date: new Date("2026-06-14T00:00:00.000Z"),
  joined_on: null,
  contract_rent: 8500,
  tenant: {
    id: "tenant-1",
    owner_id: "owner-1",
    hostel_id: "hostel-1",
    monthly_rent: 8000,
    joined_on: new Date("2026-06-14T00:00:00.000Z"),
    room_allocations: [
      {
        id: "alloc-1",
        is_active: true,
        end_date: null,
        room: { base_rent: 7000, hostel_id: "hostel-1", hostels: { id: "hostel-1" } },
      },
    ],
    hostels: { id: "hostel-1", owner_id: "owner-1", due_day: 10 },
  },
};

function createTx() {
  const rows: any[] = [];
  return {
    rows,
    $queryRaw: vi.fn((_strings: TemplateStringsArray, ids: string[]) =>
      rows.filter((row) => ids?.includes(row.id)).map((row) => ({ id: row.id, status: row.status }))
    ),
    agreement: {
      findUnique: vi.fn(async () => agreement),
    },
    rent_obligations: {
      findFirst: vi.fn(async ({ where }: any) => rows.find((row) => {
        if (where.OR) {
          return where.OR.some((clause: any) =>
            (!clause.agreement_id || clause.agreement_id === row.agreement_id) &&
            (!clause.allocation_id || clause.allocation_id === row.allocation_id) &&
            clause.rent_month.getTime() === row.rent_month.getTime() &&
            where.obligation_type === row.obligation_type &&
            where.is_superseded === Boolean(row.is_superseded)
          );
        }
        return false;
      }) || null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `row-${rows.length + 1}`, payments: [], ...data };
        rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const index = rows.findIndex((row) => row.id === where.id);
        rows[index] = { ...rows[index], ...data };
        return rows[index];
      }),
    },
  };
}

describe("AgreementRentScheduleService — dual-write consistency", () => {
  let service: AgreementRentScheduleService;

  beforeEach(() => {
    service = new AgreementRentScheduleService();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // M3 Fix: Obligation creation initializes all three status columns
  // ───────────────────────────────────────────────────────────────────────────

  it("new PENDING obligation has lifecycle_status=ACTIVE and settlement_status=UNPAID", async () => {
    const tx = createTx();

    await service.generateForAgreementInTx(tx as any, "agreement-1", {
      now: new Date("2026-06-19T00:00:00.000Z"),
    });

    // June obligation should be PENDING (current month)
    const juneOb = tx.rows.find((r: any) =>
      r.rent_month.toISOString().startsWith("2026-06")
    );
    expect(juneOb).toBeDefined();
    expect(juneOb.status).toBe("PENDING");
    expect(juneOb.lifecycle_status).toBe("ACTIVE");
    expect(juneOb.settlement_status).toBe("UNPAID");
  });

  it("new UPCOMING obligation has lifecycle_status=ACTIVE and settlement_status=UNPAID", async () => {
    const tx = createTx();

    await service.generateForAgreementInTx(tx as any, "agreement-1", {
      now: new Date("2026-06-19T00:00:00.000Z"),
    });

    // July obligation should be UPCOMING (future month)
    const julyOb = tx.rows.find((r: any) =>
      r.rent_month.toISOString().startsWith("2026-07")
    );
    expect(julyOb).toBeDefined();
    expect(julyOb.status).toBe("UPCOMING");
    expect(julyOb.lifecycle_status).toBe("ACTIVE");
    expect(julyOb.settlement_status).toBe("UNPAID");
  });

  it("OVERDUE computed status is persisted as PENDING with correct dual-write columns", async () => {
    const tx = createTx();

    // Run in August — both June and July are past due, so statusFor returns OVERDUE
    // but the service converts OVERDUE → PENDING before writing
    await service.generateForAgreementInTx(tx as any, "agreement-1", {
      now: new Date("2026-08-15T00:00:00.000Z"),
    });

    for (const row of tx.rows) {
      expect(row.status).toBe("PENDING");
      expect(row.lifecycle_status).toBe("ACTIVE");
      expect(row.settlement_status).toBe("UNPAID");
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  // M3 Fix: Obligation update path synchronizes dual-write columns
  // ───────────────────────────────────────────────────────────────────────────

  it("updating an existing obligation synchronizes all three status columns", async () => {
    const tx = createTx();

    // First pass: create obligations
    await service.generateForAgreementInTx(tx as any, "agreement-1", {
      now: new Date("2026-06-19T00:00:00.000Z"),
    });

    // Clear lifecycle/settlement to simulate a pre-migration obligation that
    // only had the legacy status column, then re-run to trigger the update path
    const julyIdx = tx.rows.findIndex((r: any) =>
      r.rent_month.toISOString().startsWith("2026-07")
    );
    tx.rows[julyIdx].lifecycle_status = undefined;
    tx.rows[julyIdx].settlement_status = undefined;
    tx.rows[julyIdx].status = "UPCOMING"; // re-updatable status

    // Second pass in July — should update UPCOMING → PENDING and set dual-write columns
    await service.generateForAgreementInTx(tx as any, "agreement-1", {
      now: new Date("2026-07-06T00:00:00.000Z"),
    });

    // Re-read from tx.rows since the mock update replaces the entry with a new object
    const julyOb = tx.rows[julyIdx];
    expect(julyOb.status).toBe("PENDING");
    expect(julyOb.lifecycle_status).toBe("ACTIVE");
    expect(julyOb.settlement_status).toBe("UNPAID");
  });

  it("does NOT overwrite dual-write columns for PAID/WAIVED/PARTIAL obligations", async () => {
    const tx = createTx();

    // First pass: create
    await service.generateForAgreementInTx(tx as any, "agreement-1", {
      now: new Date("2026-06-19T00:00:00.000Z"),
    });

    // Simulate the June obligation being settled outside this service
    const juneOb = tx.rows.find((r: any) =>
      r.rent_month.toISOString().startsWith("2026-06")
    );
    juneOb.status = "PAID";
    juneOb.lifecycle_status = "ACTIVE";
    juneOb.settlement_status = "PAID";

    // Second pass — should NOT touch the PAID obligation's status columns
    await service.generateForAgreementInTx(tx as any, "agreement-1", {
      now: new Date("2026-06-19T00:00:00.000Z"),
    });

    expect(juneOb.status).toBe("PAID");
    expect(juneOb.lifecycle_status).toBe("ACTIVE");
    expect(juneOb.settlement_status).toBe("PAID");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // M2 Fix: syncDueStatuses backfill preserves dual-write consistency
  // ───────────────────────────────────────────────────────────────────────────

  describe("syncDueStatuses dual-write backfill", () => {
    it("backfills OVERDUE → PENDING with lifecycle_status=ACTIVE, settlement_status=UNPAID", async () => {
      let updatedData: any = null;

      // Mock prisma for syncDueStatuses (it uses the top-level prisma, not a tx)
      const mockPrisma = await import("@/lib/db");
      const mockRentObligations = {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "ob-overdue-1",
            status: "OVERDUE",
            payments: [], // no payments → PENDING
          },
        ]),
        update: vi.fn(async ({ data }: any) => {
          updatedData = data;
          return { id: "ob-overdue-1", ...data };
        }),
        count: vi.fn().mockResolvedValue(0),
      };
      (mockPrisma as any).prisma = {
        rent_obligations: mockRentObligations,
        $transaction: vi.fn((fn: any) => fn(mockPrisma.prisma)),
      };

      const svc = new AgreementRentScheduleService();
      await svc.syncDueStatuses({ now: new Date("2026-07-10T00:00:00.000Z") });

      expect(updatedData).toBeDefined();
      expect(updatedData.status).toBe("PENDING");
      expect(updatedData.lifecycle_status).toBe("ACTIVE");
      expect(updatedData.settlement_status).toBe("UNPAID");
    });

    it("backfills OVERDUE → PARTIAL with lifecycle_status=ACTIVE, settlement_status=PARTIAL", async () => {
      let updatedData: any = null;

      const mockPrisma = await import("@/lib/db");
      const mockRentObligations = {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "ob-overdue-2",
            status: "OVERDUE",
            payments: [{ amount_paid: 2000 }], // has payments → PARTIAL
          },
        ]),
        update: vi.fn(async ({ data }: any) => {
          updatedData = data;
          return { id: "ob-overdue-2", ...data };
        }),
        count: vi.fn().mockResolvedValue(0),
      };
      (mockPrisma as any).prisma = {
        rent_obligations: mockRentObligations,
        $transaction: vi.fn((fn: any) => fn(mockPrisma.prisma)),
      };

      const svc = new AgreementRentScheduleService();
      await svc.syncDueStatuses({ now: new Date("2026-07-10T00:00:00.000Z") });

      expect(updatedData).toBeDefined();
      expect(updatedData.status).toBe("PARTIAL");
      expect(updatedData.lifecycle_status).toBe("ACTIVE");
      expect(updatedData.settlement_status).toBe("PARTIAL");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // fromLegacyStatus correctness (ensures the mapping is consistent)
  // ───────────────────────────────────────────────────────────────────────────

  describe("fromLegacyStatus mapping used by dual-write", () => {
    it.each([
      ["PENDING",   "ACTIVE",    "UNPAID"],
      ["UPCOMING",  "ACTIVE",    "UNPAID"],
      ["PARTIAL",   "ACTIVE",    "PARTIAL"],
      ["PAID",      "ACTIVE",    "PAID"],
      ["WAIVED",    "WAIVED",    "UNPAID"],
      ["CANCELLED", "CANCELLED", "UNPAID"],
    ])("maps %s → lifecycle=%s, settlement=%s", (legacy, expectedLifecycle, expectedSettlement) => {
      const result = fromLegacyStatus(legacy);
      expect(result.lifecycle_status).toBe(expectedLifecycle);
      expect(result.settlement_status).toBe(expectedSettlement);
    });
  });
});
