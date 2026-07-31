import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  creditIdempotentInTx: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/src/services/payments/tenant-financial-ledger-service", () => ({
  tenantFinancialLedgerService: {
    creditIdempotentInTx: mocks.creditIdempotentInTx,
  },
}));

import { PaymentService } from "@/src/services/payments/payment-service";

const tenant = {
  id: "tenant-1",
  owner_id: "owner-1",
  hostel_id: "hostel-1",
  monthly_rent: 8500,
};

function obligation(id: string, dueDate: string, amount = 8500, payments: any[] = [], status = "PENDING") {
  return {
    id,
    tenant_id: tenant.id,
    owner_id: tenant.owner_id,
    hostel_id: tenant.hostel_id,
    amount,
    status,
    obligation_type: "RENT",
    rent_month: new Date(dueDate),
    due_date: new Date(dueDate),
    payments,
    tenants: { id: tenant.id, owner_id: tenant.owner_id, hostel_id: tenant.hostel_id },
    room_allocations: null,
  };
}

function createTx(rows: any[]) {
  const payments: any[] = [];
  const updatedStatuses: Record<string, string> = {};
  return {
    updatedStatuses,
    $queryRaw: vi.fn(async () => rows.filter((row) => ["OVERDUE", "PENDING", "PARTIAL", "UPCOMING"].includes(row.status)).map((row) => ({ id: row.id }))),
    $queryRawUnsafe: vi.fn(async () => rows.filter((row) => ["OVERDUE", "PENDING", "PARTIAL", "UPCOMING"].includes(row.status)).map((row) => ({ id: row.id }))),
    hostels: {
      findUnique: vi.fn(async () => ({
        id: "hostel-1",
        preferences_config: { enforceOverdueRentPayment: true },
      })),
    },
    tenants: {
      findUnique: vi.fn(async () => tenant),
    },
    rent_obligations: {
      // Two shapes are queried by the plan-first flow: an unfiltered snapshot
      // fetch by tenant/hostel/status (Settlement Planner input), and a
      // locked re-fetch by id (Settlement Engine execution).
      findMany: vi.fn(async ({ where }: any) => {
        if (where.id?.in) return rows.filter((row) => where.id.in.includes(row.id));
        return rows.filter((row) =>
          row.tenant_id === where.tenant_id &&
          (!where.hostel_id || row.hostel_id === where.hostel_id) &&
          (!where.status?.in || where.status.in.includes(row.status))
        );
      }),
      update: vi.fn(async ({ where, data }: any) => {
        updatedStatuses[where.id] = data.status;
        const row = rows.find((item) => item.id === where.id);
        if (row) row.status = data.status;
        return row;
      }),
    },
    payments: {
      create: vi.fn(async ({ data }: any) => {
        const payment = { id: `payment-${payments.length + 1}`, ...data };
        payments.push(payment);
        return payment;
      }),
    },
    payment_groups: {
      create: vi.fn(async ({ data }: any) => ({ id: data.id, ...data })),
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
  };
}

describe("PaymentService FIFO rent settlement", () => {
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.creditIdempotentInTx.mockResolvedValue({ entry: { id: "ledger-1" }, balance: 500, alreadyCredited: false });
    service = new PaymentService() as any;
  });

  it("settles exact rent oldest first and leaves upcoming untouched", async () => {
    const due = obligation("due", "2026-06-05", 8500, [], "OVERDUE");
    const upcoming = obligation("upcoming", "2026-07-05", 8500, [], "UPCOMING");
    const tx = createTx([upcoming, due]);

    const result = await service._settleTenantRentPaymentInTx(tx, {
      hostelId: "hostel-1",
      tenantId: "tenant-1",
      amountPaid: 8500,
      paymentMethod: "UPI",
    }, "group-1");

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].obligation_id).toBe("due");
    expect(tx.updatedStatuses).toEqual({ due: "PAID" });
    expect(mocks.creditIdempotentInTx).not.toHaveBeenCalled();
  });

  it("settles upcoming obligation when no other overdue/pending obligations exist", async () => {
    const upcoming = obligation("upcoming", "2026-07-05", 8500, [], "UPCOMING");
    const tx = createTx([upcoming]);

    const result = await service._settleTenantRentPaymentInTx(tx, {
      hostelId: "hostel-1",
      tenantId: "tenant-1",
      amountPaid: 8500,
      paymentMethod: "UPI",
    }, "group-3");

    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].obligation_id).toBe("upcoming");
    expect(tx.updatedStatuses).toEqual({ upcoming: "PAID" });
    expect(mocks.creditIdempotentInTx).not.toHaveBeenCalled();
  });

  it("allocates oldest first when the amount fits the existing installments", async () => {
    const june = obligation("june", "2026-06-05", 8500, [], "OVERDUE");
    const july = obligation("july", "2026-07-05", 8500, [{ amount_paid: 3500, hostel_id: "hostel-1" }], "PARTIAL");
    const tx = createTx([july, june]);

    const result = await service._settleTenantRentPaymentInTx(tx, {
      hostelId: "hostel-1",
      tenantId: "tenant-1",
      amountPaid: 13500, // exactly June 8500 + July's remaining 5000
      paymentMethod: "CASH",
      userId: "owner-1",
    }, "group-2");

    expect(result.allocations.map((row: any) => [row.obligation_id, row.allocated])).toEqual([
      ["june", 8500],
      ["july", 5000],
    ]);
    // ADR-036: settlement never touches the ledger any more.
    expect(mocks.creditIdempotentInTx).not.toHaveBeenCalled();
  });

  it("refuses an overpayment that no installment can absorb", async () => {
    // ADR-036: the excess used to be credited as future rent. Now it must land
    // on a real installment — and with no ACTIVE agreement to generate one
    // from, the payment is rejected rather than parked anywhere.
    const june = obligation("june", "2026-06-05", 8500, [], "OVERDUE");
    const july = obligation("july", "2026-07-05", 8500, [{ amount_paid: 3500, hostel_id: "hostel-1" }], "PARTIAL");
    const tx = createTx([july, june]);

    await expect(
      service._settleTenantRentPaymentInTx(tx, {
        hostelId: "hostel-1",
        tenantId: "tenant-1",
        amountPaid: 15000, // 1500 more than the 13500 outstanding
        paymentMethod: "CASH",
        userId: "owner-1",
      }, "group-3"),
    ).rejects.toThrow(/BAD_REQUEST/);

    expect(mocks.creditIdempotentInTx).not.toHaveBeenCalled();
  });
});
