import { beforeEach, describe, expect, it, vi } from "vitest";
import { PAYMENT_DOMAIN, PAYMENT_FLOW, SETTLEMENT_STATUS } from "@/src/services/payments/financial-domain";

const mocks = vi.hoisted(() => {
  const ledgerEntries: any[] = [];
  const rentObligations: any[] = [];
  const payments: any[] = [];
  let nextPaymentId = 1;

  const tx = {
    $queryRaw: vi.fn(async () => {
      return rentObligations.map(ob => ({ id: ob.id }));
    }),
    $queryRawUnsafe: vi.fn(async () => {
      return rentObligations.map(ob => ({ id: ob.id }));
    }),
    paymentAttempt: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    hostels: {
      findUnique: vi.fn(async () => ({
        id: "hostel-abc",
        preferences_config: { enforceOverdueRentPayment: true },
      })),
    },
    rent_obligations: {
      findMany: vi.fn(async (params?: any) => {
        const where = params?.where || {};
        return rentObligations.filter(ob => {
          if (where.tenant_id && ob.tenant_id !== where.tenant_id) return false;
          if (where.hostel_id && ob.hostel_id !== where.hostel_id) return false;
          if (where.status) {
            if (where.status.in && !where.status.in.includes(ob.status)) return false;
            if (typeof where.status === "string" && ob.status !== where.status) return false;
          }
          return true;
        }).map(ob => {
          const obPayments = payments.filter(p => p.obligation_id === ob.id);
          return {
            ...ob,
            payments: obPayments.map(p => ({ amount_paid: p.amount_paid })),
          };
        });
      }),
      update: vi.fn(),
    },
    tenants: {
      findUnique: vi.fn(async () => ({
        id: "tenant-abc",
        monthly_rent: 10000,
        security_deposit: 15000,
        hostel_id: "hostel-abc",
        owner_id: "owner-abc",
      })),
    },
    tenant_financial_ledger: {
      findMany: vi.fn(async (params?: any) => {
        const where = params?.where || {};
        const matchesCondition = (entry: any, cond: any) => {
          if (cond.tenant_id && entry.tenant_id !== cond.tenant_id) return false;
          if (cond.type && entry.type !== cond.type) return false;
          if (cond.reference_type && entry.reference_type !== cond.reference_type) return false;
          if (cond.reference_id) {
            if (typeof cond.reference_id === "object" && cond.reference_id.in) {
              if (!cond.reference_id.in.includes(entry.reference_id)) return false;
            } else if (entry.reference_id !== cond.reference_id) {
              return false;
            }
          }
          return true;
        };
        return ledgerEntries.filter(entry => {
          if (!matchesCondition(entry, where)) return false;
          if (where.OR) {
            return where.OR.some((cond: any) => matchesCondition(entry, { ...cond, tenant_id: where.tenant_id, type: where.type }));
          }
          return true;
        });
      }),
    },
    payments: {
      findMany: vi.fn(async (params?: any) => {
        const where = params?.where || {};
        return payments.filter(p => {
          if (where.payment_attempt_id && p.payment_attempt_id !== where.payment_attempt_id) return false;
          return true;
        });
      }),
      create: vi.fn(async ({ data }: any) => {
        const p = {
          id: `p-${nextPaymentId++}`,
          ...data,
          amount_paid: data.amount_paid,
        };
        payments.push(p);
        return p;
      }),
    },
    payment_groups: {
      create: vi.fn(async ({ data }: any) => ({ id: data.id, ...data })),
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
  };

  return {
    tx,
    ledgerEntries,
    rentObligations,
    payments,
    prisma: {
      paymentAttempt: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      payment_attempt_obligations: {
        findMany: vi.fn(async () => []),
      },
      tenants: {
        findUnique: vi.fn(async () => ({
          id: "tenant-abc",
          monthly_rent: 10000,
          security_deposit: 15000,
          hostel_id: "hostel-abc",
          owner_id: "owner-abc",
        })),
      },
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    },
    tenantFinancialLedgerService: {
      creditIdempotentInTx: vi.fn(),
    },
    paymentStatusEventService: {
      append: vi.fn(),
      appendOutsideTransaction: vi.fn(),
    },
    eventLog: {
      log: vi.fn(),
    },
    getSession: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/src/services/payments/tenant-financial-ledger-service", () => ({
  tenantFinancialLedgerService: mocks.tenantFinancialLedgerService,
}));
vi.mock("../src/services/payments/tenant-financial-ledger-service", () => ({
  tenantFinancialLedgerService: mocks.tenantFinancialLedgerService,
}));
vi.mock("@/lib/services/payment-status-event-service", () => ({
  paymentStatusEventService: mocks.paymentStatusEventService,
}));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: mocks.eventLog }));
vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));
vi.mock("@/lib/logger", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock("@/lib/metrics", () => ({
  incrementPayment: vi.fn(),
  incrementWebhook: vi.fn(),
}));
vi.mock("@/lib/events", () => ({ eventSystem: { trigger: vi.fn() } }));
vi.mock("@/lib/services/email-service", () => ({ EmailService: vi.fn() }));
vi.mock("@/src/services/payments/provider-factory", () => ({ PaymentProviderFactory: {} }));
vi.mock("../src/services/payments/provider-factory", () => ({ PaymentProviderFactory: {} }));
vi.mock("@/src/services/payments/receipt-service", () => ({
  receiptService: {
    createReceipt: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock("../src/services/payments/receipt-service", () => ({
  receiptService: {
    createReceipt: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock("@/lib/services/tenant-analytics-service", () => ({ tenantAnalyticsService: {} }));
vi.mock("@/src/services/payments/financial-service", () => ({ financialService: {} }));
vi.mock("../src/services/payments/financial-service", () => ({ financialService: {} }));
vi.mock("@/src/repositories/paymentRepository", () => ({ paymentRepository: {} }));
vi.mock("@/lib/services/payment-operational-anomaly-service", () => ({ paymentOperationalAnomalyService: {} }));
vi.mock("@/lib/services/payment-webhook-event-service", () => ({ paymentWebhookEventService: {} }));
vi.mock("@/lib/services/payment-provider-verification-snapshot-service", () => ({
  paymentProviderVerificationSnapshotService: {},
}));
vi.mock("@/src/services/tenants/activation-financial-status-service", () => ({
  activationFinancialStatusService: {
    getActivationFinancialStatus: vi.fn(),
  },
}));
vi.mock("@/lib/config/domains", () => ({ backendUrl: "https://example.test" }));

describe("Transaction-Level Settlement Invariant Auditing", () => {
  const baseAttempt = {
    id: "attempt-abc",
    tenant_id: "tenant-abc",
    owner_id: "owner-abc",
    hostel_id: "hostel-abc",
    merchant_txn_id: "merchant-abc",
    amount: 15000,
    status: "PROCESSING",
    payments: [],
    payment_domain: PAYMENT_DOMAIN.RENT_COLLECTION,
    provider: "RAZORPAY",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ledgerEntries.length = 0;
    mocks.rentObligations.length = 0;
    mocks.payments.length = 0;

    mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(mocks.tx));
    mocks.prisma.paymentAttempt.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.paymentAttempt.findUnique.mockResolvedValue(baseAttempt);
    mocks.tx.paymentAttempt.findUnique.mockResolvedValue({
      ...baseAttempt,
      status: "SUCCESS",
    });
    mocks.tx.paymentAttempt.update.mockImplementation(async ({ data }: any) => ({
      ...baseAttempt,
      ...data,
      settlement_status: data.settlement_status ?? SETTLEMENT_STATUS.SETTLED,
    }));

    mocks.tenantFinancialLedgerService.creditIdempotentInTx.mockImplementation(async (tx, params) => {
      mocks.ledgerEntries.push({
        amount: params.amount,
        type: "CREDIT",
        reference_id: params.referenceId,
        reference_type: params.referenceType,
        tenant_id: params.tenantId,
      });
      return { alreadyCredited: false };
    });
  });

  it("settles Rent payment with excess (future rent credit topup) successfully", async () => {
    mocks.rentObligations.push(
      { id: "ob-1", amount: 8000, tenant_id: "tenant-abc", hostel_id: "hostel-abc", status: "PENDING", tenants: { id: "tenant-abc", hostel_id: "hostel-abc" }, payments: [] },
      { id: "ob-2", amount: 2000, tenant_id: "tenant-abc", hostel_id: "hostel-abc", status: "PENDING", tenants: { id: "tenant-abc", hostel_id: "hostel-abc" }, payments: [] }
    );

    const attempt = {
      ...baseAttempt,
      flow_type: PAYMENT_FLOW.RENT,
      payment_type: "RENT",
      amount: 15000,
    };

    mocks.prisma.paymentAttempt.findUnique
      .mockResolvedValueOnce({ ...attempt, status: "PENDING" })
      .mockResolvedValueOnce(attempt);

    mocks.tx.rent_obligations.update.mockImplementation(async ({ where, data }: any) => {
      const ob = mocks.rentObligations.find(o => o.id === where.id);
      if (ob) {
        ob.status = data.status;
      }
      return ob;
    });

    const { PaymentService } = await import("@/src/services/payments/payment-service");
    const service = new PaymentService();

    await service.finalizePaymentAttempt("attempt-abc", "SUCCESS", "gateway-abc");

    const totalAllocated = mocks.payments.reduce((sum, p) => sum + Number(p.amount_paid), 0);
    expect(totalAllocated).toBe(10000);

    const ledgerCredits = mocks.ledgerEntries.filter(e => e.reference_id === "attempt-abc" && e.type === "CREDIT");
    const totalLedgerCredited = ledgerCredits.reduce((sum, e) => sum + Number(e.amount), 0);
    expect(totalLedgerCredited).toBe(5000);

    expect(totalAllocated + totalLedgerCredited).toBe(15000);
  });

  it("throws error if settlement does not account for the entire captured amount", async () => {
    mocks.rentObligations.push(
      { id: "ob-1", amount: 10000, tenant_id: "tenant-abc", hostel_id: "hostel-abc", status: "PENDING", tenants: { id: "tenant-abc", hostel_id: "hostel-abc" }, payments: [] }
    );

    const attempt = {
      ...baseAttempt,
      flow_type: PAYMENT_FLOW.RENT,
      payment_type: "RENT",
      amount: 15000,
    };

    mocks.prisma.paymentAttempt.findUnique
      .mockResolvedValueOnce({ ...attempt, status: "PENDING" })
      .mockResolvedValueOnce(attempt);

    // Bypass ledger credits to trigger settlement mismatch error
    mocks.tenantFinancialLedgerService.creditIdempotentInTx.mockResolvedValue({ alreadyCredited: false });

    const { PaymentService } = await import("@/src/services/payments/payment-service");
    const service = new PaymentService();

    await expect(
      service.finalizePaymentAttempt("attempt-abc", "SUCCESS", "gateway-abc")
    ).rejects.toThrow(/INVARIANT_VIOLATION: Settlement mismatch/);
  });

  it("settles Advance top-up flow successfully and passes invariants", async () => {
    const attempt = {
      ...baseAttempt,
      flow_type: PAYMENT_FLOW.FUTURE_RENT_CREDIT,
      payment_type: "FUTURE_RENT_CREDIT",
      amount: 15000,
    };

    mocks.prisma.paymentAttempt.findUnique
      .mockResolvedValueOnce({ ...attempt, status: "PENDING" })
      .mockResolvedValueOnce(attempt);

    const { PaymentService } = await import("@/src/services/payments/payment-service");
    const service = new PaymentService();

    await service.finalizePaymentAttempt("attempt-abc", "SUCCESS", "gateway-abc");

    const totalAllocated = mocks.payments.reduce((sum, p) => sum + Number(p.amount_paid), 0);
    expect(totalAllocated).toBe(0);

    const ledgerCredits = mocks.ledgerEntries.filter(e => e.reference_id === "attempt-abc" && e.type === "CREDIT");
    const totalLedgerCredited = ledgerCredits.reduce((sum, e) => sum + Number(e.amount), 0);
    expect(totalLedgerCredited).toBe(15000);

    expect(totalAllocated + totalLedgerCredited).toBe(15000);
  });

  it("settles a gateway Rent payment that fully allocates into a SECURITY_DEPOSIT obligation without a false invariant violation", async () => {
    // Regression test: settlement-engine.ts credits the ledger a second time
    // (reason DEPOSIT, referenceType PAYMENT, keyed by the individual
    // `payments` row) whenever an allocation lands on a SECURITY_DEPOSIT or
    // ADVANCE obligation. That credit is a "collected" mirror of money
    // already counted in `totalAllocated`, not additional unallocated money.
    // Before the fix, validatePaymentAttemptSettlementInTx only looked for
    // ledger credits keyed by attemptId, so it never found this mirror
    // credit — a real gateway payment (Razorpay captured the charge) rolled
    // back with INVARIANT_VIOLATION and returned a 500 despite the
    // settlement itself being entirely correct.
    mocks.rentObligations.push({
      id: "ob-deposit",
      amount: 15000,
      tenant_id: "tenant-abc",
      hostel_id: "hostel-abc",
      status: "PENDING",
      obligation_type: "SECURITY_DEPOSIT",
      tenants: { id: "tenant-abc", hostel_id: "hostel-abc" },
      payments: [],
    });

    const attempt = {
      ...baseAttempt,
      flow_type: PAYMENT_FLOW.RENT,
      payment_type: "RENT",
      amount: 15000,
    };

    mocks.prisma.paymentAttempt.findUnique
      .mockResolvedValueOnce({ ...attempt, status: "PENDING" })
      .mockResolvedValueOnce(attempt);

    mocks.tx.rent_obligations.update.mockImplementation(async ({ where, data }: any) => {
      const ob = mocks.rentObligations.find(o => o.id === where.id);
      if (ob) ob.status = data.status;
      return ob;
    });

    // Mirror settlement-engine.ts's real ADVANCE/SECURITY_DEPOSIT branch:
    // credited with referenceType "PAYMENT", keyed by the payment row's id,
    // NOT by attemptId.
    mocks.tenantFinancialLedgerService.creditIdempotentInTx.mockImplementation(async (_tx: any, params: any) => {
      mocks.ledgerEntries.push({
        amount: params.amount,
        type: "CREDIT",
        reference_id: params.referenceId,
        reference_type: params.referenceType,
        tenant_id: params.tenantId,
      });
      return { alreadyCredited: false };
    });

    const { PaymentService } = await import("@/src/services/payments/payment-service");
    const service = new PaymentService();

    await expect(
      service.finalizePaymentAttempt("attempt-abc", "SUCCESS", "gateway-abc")
    ).resolves.toBeDefined();

    const totalAllocated = mocks.payments.reduce((sum, p) => sum + Number(p.amount_paid), 0);
    expect(totalAllocated).toBe(15000);

    const depositCredit = mocks.ledgerEntries.find(e => e.reference_type === "PAYMENT" && e.type === "CREDIT");
    expect(depositCredit?.amount).toBe(15000);
    expect(depositCredit?.reference_id).not.toBe("attempt-abc");
  });

  it("settles offline cash payment via recordTenantPayment successfully and passes invariants", async () => {
    mocks.rentObligations.push(
      { id: "ob-1", amount: 8000, tenant_id: "tenant-abc", hostel_id: "hostel-abc", status: "PENDING", tenants: { id: "tenant-abc", hostel_id: "hostel-abc" }, payments: [] },
      { id: "ob-2", amount: 2000, tenant_id: "tenant-abc", hostel_id: "hostel-abc", status: "PENDING", tenants: { id: "tenant-abc", hostel_id: "hostel-abc" }, payments: [] }
    );

    const { PaymentService } = await import("@/src/services/payments/payment-service");
    const service = new PaymentService();

    const result = await service.recordTenantPayment({
      hostelId: "hostel-abc",
      tenantId: "tenant-abc",
      amountPaid: 15000,
      paymentMethod: "CASH",
    });

    const totalAllocated = mocks.payments.reduce((sum, p) => sum + Number(p.amount_paid), 0);
    expect(totalAllocated).toBe(10000);

    const ledgerCredits = mocks.ledgerEntries.filter(e => e.type === "CREDIT");
    const totalLedgerCredited = ledgerCredits.reduce((sum, e) => sum + Number(e.amount), 0);
    expect(totalLedgerCredited).toBe(5000);

    expect(totalAllocated + totalLedgerCredited).toBe(15000);
  });
});
