import { beforeEach, describe, expect, it, vi } from "vitest";
import { inferAttemptFinancialMetadata, PAYMENT_DOMAIN, PAYMENT_FLOW, SETTLEMENT_STATUS } from "@/src/services/payments/financial-domain";

const mocks = vi.hoisted(() => {
  const ledgerEntries: any[] = [];
  const tx = {
    $queryRaw: vi.fn(),
    paymentAttempt: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    payment_attempt_obligations: {
      findMany: vi.fn(async () => []),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    rent_obligations: {
      findMany: vi.fn(async () => []),
    },
    tenant_financial_ledger: {
      findMany: vi.fn(async (params?: any) => {
        const where = params?.where || {};
        return ledgerEntries.filter(entry => {
          if (where.tenant_id && entry.tenant_id !== where.tenant_id) return false;
          if (where.reference_id && entry.reference_id !== where.reference_id) return false;
          if (where.type && entry.type !== where.type) return false;
          return true;
        });
      }),
    },
    payments: {
      findMany: vi.fn(async () => []),
    },
  };

  return {
    tx,
    ledgerEntries,
    prisma: {
      paymentAttempt: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      payment_attempt_obligations: {
        findMany: vi.fn(async () => []),
      },
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    },
    tenantFinancialLedgerService: {
      credit: vi.fn(),
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
    apiResponse: vi.fn((data: any, status = 200) => ({ data, status })),
    apiError: vi.fn((message: string, code: string, status = 500) => ({ error: { message, code }, status })),
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
  apiResponse: mocks.apiResponse,
  apiError: mocks.apiError,
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
vi.mock("@/src/services/payments/receipt-service", () => ({ receiptService: {} }));
vi.mock("../src/services/payments/receipt-service", () => ({ receiptService: {} }));
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

describe("Release C5 deposit payment flow", () => {
  const baseAttempt = {
    id: "attempt-1",
    tenant_id: "tenant-1",
    owner_id: "owner-1",
    hostel_id: "hostel-1",
    merchant_txn_id: "merchant-1",
    amount: 10000,
    status: "PROCESSING",
    payments: [],
    payment_domain: PAYMENT_DOMAIN.RENT_COLLECTION,
    provider: "RAZORPAY",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ledgerEntries.length = 0;
    mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(mocks.tx));
    mocks.prisma.paymentAttempt.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.paymentAttempt.update.mockImplementation(async ({ data }: any) => ({
      ...baseAttempt,
      ...data,
      settlement_status: data.settlement_status ?? SETTLEMENT_STATUS.SETTLED,
    }));
    mocks.tx.paymentAttempt.findUnique.mockImplementation(async () => ({
      ...baseAttempt,
      status: "SUCCESS",
    }));
    mocks.tenantFinancialLedgerService.creditIdempotentInTx.mockImplementation(async (tx, params) => {
      mocks.ledgerEntries.push({
        amount: params.amount,
        type: "CREDIT",
        reference_id: params.referenceId,
        tenant_id: params.tenantId,
      });
      return { alreadyCredited: false };
    });
  });

  it("credits successful onboarding deposit payments as SECURITY_DEPOSIT_COLLECTED ledger entries", async () => {
    const { PaymentService } = await import("@/src/services/payments/payment-service");
    const service = new PaymentService();
    const attempt = { ...baseAttempt, flow_type: PAYMENT_FLOW.SECURITY_DEPOSIT, payment_type: "SECURITY_DEPOSIT" };
    mocks.prisma.paymentAttempt.findUnique
      .mockResolvedValueOnce({
        status: "PENDING",
        owner_id: attempt.owner_id,
        hostel_id: attempt.hostel_id,
        payment_domain: attempt.payment_domain,
        flow_type: attempt.flow_type,
      })
      .mockResolvedValueOnce(attempt);

    await service.finalizePaymentAttempt("attempt-1", "SUCCESS", "gateway-1");

    expect(mocks.tenantFinancialLedgerService.creditIdempotentInTx).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({
      tenantId: "tenant-1",
      ownerId: "owner-1",
      amount: 10000,
      referenceId: "attempt-1",
      referenceType: "PAYMENT_ATTEMPT",
      reason: "SECURITY_DEPOSIT_COLLECTED",
    }));
    expect(mocks.tx.paymentAttempt.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "attempt-1" },
      data: expect.objectContaining({
        status: "SUCCESS",
        settlement_status: SETTLEMENT_STATUS.SETTLED,
      }),
    }));
    expect(mocks.eventLog.log).toHaveBeenCalledWith("DEPOSIT_CREDITED", "owner-1", expect.any(Object));
  });

  it("continues to credit future-rent advance payments as TOPUP ledger entries", async () => {
    const { PaymentService } = await import("@/src/services/payments/payment-service");
    const service = new PaymentService();
    const attempt = { ...baseAttempt, flow_type: PAYMENT_FLOW.FUTURE_RENT_CREDIT, payment_type: "FUTURE_RENT_CREDIT" };
    mocks.prisma.paymentAttempt.findUnique
      .mockResolvedValueOnce({
        status: "PENDING",
        owner_id: attempt.owner_id,
        hostel_id: attempt.hostel_id,
        payment_domain: attempt.payment_domain,
        flow_type: attempt.flow_type,
      })
      .mockResolvedValueOnce(attempt);

    await service.finalizePaymentAttempt("attempt-1", "SUCCESS", "gateway-1");

    expect(mocks.tenantFinancialLedgerService.creditIdempotentInTx).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({
      tenantId: "tenant-1",
      reason: "TOPUP",
    }));
    expect(mocks.eventLog.log).toHaveBeenCalledWith("ADVANCE_CREDITED", "owner-1", expect.any(Object));
  });

  it("manual owner recording can create an explicit DEPOSIT ledger credit", async () => {
    const { POST } = await import("@/app/api/tenants/[id]/financial-ledger/route");
    mocks.getSession.mockResolvedValue({ role: "OWNER", sub: "owner-1" });
    mocks.tenantFinancialLedgerService.credit.mockResolvedValue({ entry: { id: "ledger-1", reason: "DEPOSIT" }, balance: 10000 });
    const request = {
      json: vi.fn().mockResolvedValue({
        action: "credit",
        reason: "DEPOSIT",
        amount: 10000,
        notes: "Security deposit received",
      }),
    } as any;

    await POST(request, { params: { id: "tenant-1" } });

    expect(mocks.tenantFinancialLedgerService.credit).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1",
      ownerId: "owner-1",
      createdBy: "owner-1",
      reason: "DEPOSIT",
      amount: 10000,
    }));
  });

  it("classifies SECURITY_DEPOSIT attempts as rent-collection treasury flow metadata", () => {
    expect(inferAttemptFinancialMetadata({
      payment_type: "SECURITY_DEPOSIT",
      hostel_id: "hostel-1",
    })).toEqual(expect.objectContaining({
      payment_domain: PAYMENT_DOMAIN.RENT_COLLECTION,
      flow_type: PAYMENT_FLOW.SECURITY_DEPOSIT,
      scope_type: "HOSTEL",
      merchant_context_type: "HMS_TREASURY",
      merchant_context_id: "HMS_TREASURY",
    }));

    expect(inferAttemptFinancialMetadata({
      flow_type: PAYMENT_FLOW.SECURITY_DEPOSIT,
      hostel_id: "hostel-1",
    })).toEqual(expect.objectContaining({
      flow_type: PAYMENT_FLOW.SECURITY_DEPOSIT,
      merchant_context_type: "HMS_TREASURY",
    }));
  });
});
