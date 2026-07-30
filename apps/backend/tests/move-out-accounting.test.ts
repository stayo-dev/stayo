import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  move_out_requests: {
    findUnique: vi.fn(),
  },
  payments: {
    aggregate: vi.fn(),
  },
};

const mockGetBalance = vi.fn();
vi.mock("../src/services/payments/tenant-financial-ledger-service", () => ({
  tenantFinancialLedgerService: {
    getBalance: mockGetBalance,
  },
}));

const mockGetTenantDues = vi.fn();
vi.mock("../src/services/payments/financial-service", () => ({
  financialService: {
    getTenantDues: mockGetTenantDues,
  },
}));

vi.mock("../lib/db", () => ({ prisma: prismaMock }));
vi.mock("../lib/services/move-out-notifications", () => ({ notifyMoveOutTransition: vi.fn() }));

describe("Move-Out Settlement Accounting Validation", () => {
  let moveOutService: import("../lib/services/move-out-service").MoveOutService;

  beforeEach(async () => {
    vi.clearAllMocks();
    moveOutService = (await import("../lib/services/move-out-service")).moveOutService;
  });

  const baseRequest = {
    id: "req-1",
    tenant_id: "tenant-1",
    owner_id: "owner-1",
    hostel_id: "hostel-1",
    tenant: {
      security_deposit: 10000,
    },
    inspection: {
      total_deductions: 0,
      damages_amount: 0,
      cleaning_fee: 0,
      missing_items_fee: 0,
      other_deductions: 0,
    },
  };

  it("Scenario 1: Deposit paid -> full refund (no deductions, no dues)", async () => {
    prismaMock.move_out_requests.findUnique.mockResolvedValue(baseRequest);
    // Ledger balance has exactly 10,000 (representing the deposit)
    mockGetBalance.mockResolvedValue({ balance: 10000 });
    // No payments outside ledger
    prismaMock.payments.aggregate.mockResolvedValue({ _sum: { amount_paid: 0 } });
    // No dues
    mockGetTenantDues.mockResolvedValue({ rent_due: 0, late_fees_due: 0, total_due: 0 });

    const result = await moveOutService.calculateSettlementPreview("req-1");

    expect(result.configured_security_deposit_amount).toBe(10000);
    expect(result.security_deposit_amount).toBe(10000);
    expect(result.advance_balance).toBe(0);
    expect(result.total_dues).toBe(0);
    expect(result.total_deductions).toBe(0);
    expect(result.net_settlement_amount).toBe(10000);
    expect(result.settlement_direction).toBe("OWNER_OWES_TENANT");
  });

  it("Scenario 2: Deposit paid -> damage deduction", async () => {
    const requestWithDamage = {
      ...baseRequest,
      inspection: {
        total_deductions: 1500,
        damages_amount: 1500,
        cleaning_fee: 0,
        missing_items_fee: 0,
        other_deductions: 0,
      },
    };
    prismaMock.move_out_requests.findUnique.mockResolvedValue(requestWithDamage);
    mockGetBalance.mockResolvedValue({ balance: 10000 });
    prismaMock.payments.aggregate.mockResolvedValue({ _sum: { amount_paid: 0 } });
    mockGetTenantDues.mockResolvedValue({ rent_due: 0, late_fees_due: 0, total_due: 0 });

    const result = await moveOutService.calculateSettlementPreview("req-1");

    expect(result.security_deposit_amount).toBe(10000);
    expect(result.total_deductions).toBe(1500);
    expect(result.damages_deduction).toBe(1500);
    expect(result.net_settlement_amount).toBe(8500); // 10000 - 1500
    expect(result.settlement_direction).toBe("OWNER_OWES_TENANT");
  });

  it("Scenario 3: Deposit paid -> maintenance deduction", async () => {
    prismaMock.move_out_requests.findUnique.mockResolvedValue(baseRequest);
    mockGetBalance.mockResolvedValue({ balance: 10000 });
    prismaMock.payments.aggregate.mockResolvedValue({ _sum: { amount_paid: 0 } });
    // Tenant owes 2,500 total (2000 rent + 500 late fee)
    mockGetTenantDues.mockResolvedValue({ rent_due: 2000, late_fees_due: 500, total_due: 2500 });

    const result = await moveOutService.calculateSettlementPreview("req-1");

    expect(result.security_deposit_amount).toBe(10000);
    expect(result.pending_rent_dues).toBe(2000);
    expect(result.pending_late_fees).toBe(500);
    expect(result.total_dues).toBe(2500);
    expect(result.net_settlement_amount).toBe(7500); // 10000 - 2500
    expect(result.settlement_direction).toBe("OWNER_OWES_TENANT");
  });

  it("Scenario 4: Future rent credit exists -> settlement calculation (no deposit)", async () => {
    const requestNoDeposit = {
      ...baseRequest,
      tenant: {
        security_deposit: 0,
      },
    };
    prismaMock.move_out_requests.findUnique.mockResolvedValue(requestNoDeposit);
    // Ledger has 4,500 advance/credit
    mockGetBalance.mockResolvedValue({ balance: 4500 });
    prismaMock.payments.aggregate.mockResolvedValue({ _sum: { amount_paid: 0 } });
    mockGetTenantDues.mockResolvedValue({ rent_due: 1000, late_fees_due: 0, total_due: 1000 });

    const result = await moveOutService.calculateSettlementPreview("req-1");

    expect(result.configured_security_deposit_amount).toBe(0);
    expect(result.security_deposit_amount).toBe(0);
    expect(result.advance_balance).toBe(4500); // Exceeds security deposit requirement
    expect(result.total_dues).toBe(1000);
    expect(result.net_settlement_amount).toBe(3500); // 4500 - 1000
    expect(result.settlement_direction).toBe("OWNER_OWES_TENANT");
  });

  it("Scenario 5: Deposit + future rent credit together", async () => {
    prismaMock.move_out_requests.findUnique.mockResolvedValue(baseRequest);
    // Ledger balance has 15,000 (10,000 security deposit + 5,000 future rent credit)
    mockGetBalance.mockResolvedValue({ balance: 15000 });
    prismaMock.payments.aggregate.mockResolvedValue({ _sum: { amount_paid: 0 } });
    // Dues of 3,000 and deductions of 2,000
    const requestWithDeductions = {
      ...baseRequest,
      inspection: {
        total_deductions: 2000,
        damages_amount: 2000,
        cleaning_fee: 0,
        missing_items_fee: 0,
        other_deductions: 0,
      },
    };
    prismaMock.move_out_requests.findUnique.mockResolvedValue(requestWithDeductions);
    mockGetTenantDues.mockResolvedValue({ rent_due: 3000, late_fees_due: 0, total_due: 3000 });

    const result = await moveOutService.calculateSettlementPreview("req-1");

    expect(result.configured_security_deposit_amount).toBe(10000);
    expect(result.security_deposit_amount).toBe(10000);
    expect(result.advance_balance).toBe(5000); // 15000 total - 10000 allocated for deposit
    expect(result.total_dues).toBe(3000);
    expect(result.total_deductions).toBe(2000);
    expect(result.net_settlement_amount).toBe(10000); // (10000 deposit + 5000 credit) - 3000 dues - 2000 deductions
    expect(result.settlement_direction).toBe("OWNER_OWES_TENANT");
  });
});
