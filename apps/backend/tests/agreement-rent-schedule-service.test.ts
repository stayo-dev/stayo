import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/preferences", () => ({
  resolvePreferences: vi.fn(() => ({ due_day: 5 })),
}));
// This suite exercises generateForAgreementInTx's own schedule-generation
// logic against a hand-rolled tx mock — activation/credit-sweep is a
// separate concern (see obligation-activation.test.ts for integration
// coverage) and is mocked out as a no-op here.
vi.mock("@/src/services/payments/financial-lifecycle-service", () => ({
  financialLifecycleService: {
    activatePayableObligations: vi.fn().mockResolvedValue([]),
    notifyActivated: vi.fn(),
  },
}));

import { AgreementRentScheduleService } from "@/src/services/payments/agreement-rent-schedule-service";

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
        const row = { id: `row-${rows.length + 1}`, payments: [], status: data.status, ...data };
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

describe("AgreementRentScheduleService", () => {
  let service: AgreementRentScheduleService;

  beforeEach(() => {
    service = new AgreementRentScheduleService();
  });

  it("creates exactly full-rent June and July obligations for a two-month mid-month agreement", async () => {
    const tx = createTx();

    const result = await service.generateForAgreementInTx(tx as any, "agreement-1", {
      now: new Date("2026-06-19T00:00:00.000Z"),
    });

    expect(result.created).toBe(2);
    expect(tx.rows).toHaveLength(2);
    expect(tx.rows.map((row) => row.rent_month.toISOString().slice(0, 10))).toEqual(["2026-06-01", "2026-07-01"]);
    expect(tx.rows.map((row) => Number(row.amount))).toEqual([8500, 8500]);
    expect(tx.rows.map((row) => row.status)).toEqual(["PENDING", "UPCOMING"]);
  });

  it("reruns without duplicating agreement obligations", async () => {
    const tx = createTx();

    await service.generateForAgreementInTx(tx as any, "agreement-1", {
      now: new Date("2026-06-19T00:00:00.000Z"),
    });
    const second = await service.generateForAgreementInTx(tx as any, "agreement-1", {
      now: new Date("2026-06-19T00:00:00.000Z"),
    });

    expect(second.created).toBe(0);
    expect(second.updated).toBe(2);
    expect(tx.rows).toHaveLength(2);
  });
});
