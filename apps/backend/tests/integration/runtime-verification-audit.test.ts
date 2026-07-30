import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { authService } from '@/lib/services/auth-service';
import { getCachedDashboard } from '@/lib/cache/dashboard-cache';
import { verifyIdentityToken } from '@/lib/auth-edge';
import { paymentService } from '@/src/services/payments/payment-service';
import { reminderService } from '@/src/services/payments/reminder-service';
import { agreementRentScheduleService } from '@/src/services/payments/agreement-rent-schedule-service';
import { tenantFinancialLedgerService } from '@/src/services/payments/tenant-financial-ledger-service';
import { dashboardService } from '@/lib/services/dashboard-service';
import { PaymentProviderFactory } from "@/src/services/payments/provider-factory";

// Factories
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant, allocateTestRoom } from '../factories/tenant-factory';
import { createTestRoom } from '../factories/room-factory';
import { createTestObligation, createTestPayment } from '../factories/payment-factory';

// Route Handlers
import { POST as createPaymentIntent } from "@/app/api/payments/create-intent/route";
import { POST as razorpayWebhook } from "@/app/api/webhooks/payments/razorpay/route";
import { POST as recordOffline } from "@/app/api/payments/record-offline/route";
import { GET as getOwnerStatsShell } from "@/app/api/dashboard/stats-shell/route";
import { GET as getTenantStats } from "@/app/api/dashboard/tenant/stats/route";

vi.mock('@/lib/services/auth-service', () => {
  return {
    authService: {
      getCurrentUser: vi.fn(),
    },
  };
});

vi.mock('@/lib/cache/dashboard-cache', () => {
  return {
    getCachedDashboard: vi.fn().mockResolvedValue(null),
    setDashboardCache: vi.fn().mockResolvedValue(undefined),
    invalidateDashboardCache: vi.fn(),
    invalidateOwnerDashboardCache: vi.fn(),
    invalidateHostelDashboardCache: vi.fn(),
    invalidatePortfolioCache: vi.fn(),
    invalidateTenantDashboardCache: vi.fn(),
  };
});

vi.mock("@/lib/auth-edge", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    verifyIdentityToken: vi.fn(),
  };
});

vi.mock("@/lib/services/rate-limit-service", () => {
  return {
    rateLimitService: {
      checkStatelessLimit: vi.fn().mockResolvedValue({ allowed: true }),
    },
  };
});

// Mock provider instance to bypass external APIs
const mockProviderInstance = {
  createIntent: vi.fn().mockImplementation(async (params: any) => {
    const orderId = `order_${crypto.randomBytes(4).toString("hex")}`;
    return {
      provider: "RAZORPAY",
      merchant_txn_id: params.merchant_txn_id,
      checkout_url: "http://localhost/checkout/mock",
      upi_intent_url: null,
      qr_payload: null,
      expires_at: null,
      gateway_txn_id: orderId,
      provider_order_id: orderId,
      provider_transaction_id: null,
      provider_reference_id: orderId,
      raw_response: { id: orderId },
    };
  }),
  verifyWebhook: vi.fn().mockImplementation(async (headers: any, rawBody: string) => {
    const pl = JSON.parse(rawBody);
    const orderPl = pl.payload.order?.entity || {};
    const paymentPl = pl.payload.payment?.entity || {};
    const mTxnId = orderPl.receipt || paymentPl.notes?.merchant_txn_id || pl.notes?.merchant_txn_id;
    return {
      status: "SUCCESS",
      merchant_txn_id: mTxnId,
      provider_order_id: orderPl.id || `order_${crypto.randomBytes(4).toString("hex")}`,
      gateway_txn_id: paymentPl.id || `pay_${crypto.randomBytes(4).toString("hex")}`,
      amount: (paymentPl.amount || orderPl.amount) / 100,
      tenant_id: paymentPl.notes?.tenant_id,
      raw_event: pl,
    };
  }),
  fetchStatus: vi.fn().mockImplementation(async (merchantTxnId: string, gatewayTxnId?: string) => {
    const fallbackId = `pay_${crypto.randomBytes(4).toString("hex")}`;
    const attempt = await prisma.paymentAttempt.findFirst({
      where: { merchant_txn_id: merchantTxnId },
    });
    return {
      status: "SUCCESS",
      provider_transaction_id: gatewayTxnId || attempt?.provider_transaction_id || fallbackId,
      provider_order_id: attempt?.provider_order_id || `order_${crypto.randomBytes(4).toString("hex")}`,
      gateway_txn_id: gatewayTxnId || attempt?.gateway_txn_id || fallbackId,
      raw_status: {},
    };
  }),
};

async function createFixture() {
  const owner = await createTestOwner();
  const hostel = await createTestHostel(owner.id);
  const room = await createTestRoom(hostel.id);
  const tenant = await createTestTenant(owner.id, hostel.id);
  await allocateTestRoom(tenant.id, room.id, { hostel_id: hostel.id });
  const tenantProfile = await prisma.profile.findUniqueOrThrow({
    where: { id: tenant.profile_id },
  });
  return { owner, hostel, room, tenant, tenantProfile };
}

async function createTestIdentityToken(userId: string, jti: string = crypto.randomUUID()) {
  await prisma.identity_tokens.create({
    data: {
      jti,
      user_id: userId,
      purpose: "OFFLINE_PAYMENT",
      action: "record_offline_payment",
      expires_at: new Date(Date.now() + 600 * 1000), // 10 minutes from now
      used: false,
    },
  });
  return jti;
}

async function verifyGlobalInvariants(tenantId: string, ownerId: string, tenantProfileId: string, hostelId: string) {
  // 1. Financial Conservation
  const successfulAttempts = await prisma.paymentAttempt.findMany({
    where: { tenant_id: tenantId, status: "SUCCESS" },
  });
  const totalAttemptsAmount = successfulAttempts.reduce((sum, a) => sum + Number(a.amount), 0);

  const offlinePayments = await prisma.payments.findMany({
    where: {
      tenant_id: tenantId,
      payment_attempt_id: null,
      payment_method: { not: "ADVANCE_ADJUSTMENT" },
    },
  });
  const totalOfflineAmount = offlinePayments.reduce((sum, p) => sum + Number(p.amount_paid), 0);

  const offlineCredits = await prisma.tenant_financial_ledger.findMany({
    where: {
      tenant_id: tenantId,
      type: "CREDIT",
      reference_type: "PAYMENT_GROUP_REMAINDER",
    },
  });
  const totalOfflineCredits = offlineCredits.reduce((sum, c) => sum + Number(c.amount), 0);

  const totalMoneyReceived = totalAttemptsAmount + totalOfflineAmount + totalOfflineCredits;

  const allPayments = await prisma.payments.findMany({
    where: { tenant_id: tenantId },
  });
  const moneyApplied = allPayments.reduce((sum, p) => sum + Number(p.amount_paid), 0);

  const ledger = await tenantFinancialLedgerService.getBalance(tenantId, ownerId);
  const futureRentCredit = ledger.future_rent_credit;

  expect(totalMoneyReceived).toBeCloseTo(moneyApplied + futureRentCredit, 2);

  // 2. Outstanding Balance Consistency
  const obligations = await prisma.rent_obligations.findMany({
    where: { tenant_id: tenantId, is_superseded: false, status: { in: ["PENDING", "PARTIAL", "UPCOMING"] } },
    include: { payments: { select: { amount_paid: true } } },
  });
  const obligationOutstanding = obligations.reduce((sum, ob) => {
    const paid = ob.payments.reduce((s, p) => s + Number(p.amount_paid), 0);
    return sum + (Number(ob.amount) - paid);
  }, 0);

  const dues = await dashboardService.getTenantStats(tenantProfileId);
  expect(dues.pending_dues).toBeCloseTo(obligationOutstanding, 2);

  // 3. Status Consistency
  const allObs = await prisma.rent_obligations.findMany({
    where: { tenant_id: tenantId },
    include: { payments: { select: { amount_paid: true } } },
  });
  for (const ob of allObs) {
    const paid = ob.payments.reduce((s, p) => s + Number(p.amount_paid), 0);
    const remaining = Number(ob.amount) - paid;
    if (remaining <= 0) {
      expect(ob.status).toBe("PAID");
    } else if (paid > 0) {
      expect(ob.status).toBe("PARTIAL");
    } else {
      expect(["PENDING", "UPCOMING"]).toContain(ob.status);
    }
  }
}

async function fireRazorpayWebhook(merchantTxnId: string, amountPaid: number, tenantId: string, razorpayPaymentId?: string) {
  const webhookSecret = "test_webhook_secret";
  process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

  const attempt = await prisma.paymentAttempt.findFirstOrThrow({
    where: { merchant_txn_id: merchantTxnId },
  });
  const orderId = attempt.provider_order_id || attempt.gateway_txn_id || "order_mock123";

  const payload = {
    event: "payment.captured",
    payload: {
      order: {
        entity: {
          id: orderId,
          receipt: merchantTxnId,
          status: "paid",
          amount: amountPaid * 100,
        },
      },
      payment: {
        entity: {
          id: razorpayPaymentId || `pay_${crypto.randomBytes(4).toString("hex")}`,
          order_id: orderId,
          status: "captured",
          amount: amountPaid * 100,
          notes: {
            merchant_txn_id: merchantTxnId,
            tenant_id: tenantId,
          },
        },
      },
    },
  };

  const rawBody = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  const req = new NextRequest("http://localhost/api/webhooks/payments/razorpay", {
    method: "POST",
    headers: {
      "x-razorpay-signature": signature,
      "Content-Type": "application/json",
    },
    body: rawBody,
  });

  return await razorpayWebhook(req);
}

describe("Billing Engine Runtime Verification Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(PaymentProviderFactory, "getProvider").mockReturnValue(mockProviderInstance as any);

    // Mock verifyIdentityToken to validate against the database token
    vi.mocked(verifyIdentityToken).mockImplementation(async (token: string, purpose: string, action: string) => {
      const dbToken = await prisma.identity_tokens.findUnique({
        where: { jti: token },
      });
      if (!dbToken || dbToken.used || dbToken.expires_at < new Date()) {
        return null;
      }
      return {
        userId: dbToken.user_id,
        jti: dbToken.jti,
        action: dbToken.action,
      };
    });
  });

  it("Scenario 1: Prepayment of July upcoming rent", async () => {
    const { owner, hostel, tenant, tenantProfile } = await createFixture();

    const due = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8500,
      total_amount: 8500,
      due_date: new Date("2026-07-05"),
      rent_month: new Date("2026-07-01"),
      status: "UPCOMING",
    });

    vi.mocked(authService.getCurrentUser).mockResolvedValue({
      id: tenant.profile_id,
      email: tenantProfile.email,
      role: "TENANT",
    } as any);

    const reqIntent = new NextRequest("http://localhost/api/payments/create-intent", {
      method: "POST",
      headers: {
        "x-auth-mode": "legacy",
        "x-user-id": tenant.profile_id,
        "x-user-role": "TENANT",
        "x-tenant-id": tenant.id,
        "x-user-email": tenantProfile.email,
      },
      body: JSON.stringify({
        payment_type: "RENT",
        amount: 8500,
        tenant_id: tenant.id,
      }),
    });

    const resIntent = await createPaymentIntent(reqIntent);
    const jsonIntent = await resIntent.json();
    expect(resIntent.status).toBe(200);

    const merchantTxnId = jsonIntent.merchant_txn_id;
    const resWebhook = await fireRazorpayWebhook(merchantTxnId, 8500, tenant.id);
    expect(resWebhook.status).toBe(200);

    const ob = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: due.id } });
    expect(ob.status).toBe("PAID");

    const ledger = await tenantFinancialLedgerService.getBalance(tenant.id, owner.id);
    expect(ledger.future_rent_credit).toBe(0);

    await verifyGlobalInvariants(tenant.id, owner.id, tenant.profile_id, hostel.id);
  });

  it("Scenario 2: Auto-reminders check", async () => {
    const { owner, hostel, tenant, tenantProfile } = await createFixture();

    const due = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8500,
      total_amount: 8500,
      due_date: new Date("2026-07-05"),
      rent_month: new Date("2026-07-01"),
      status: "PAID",
    });
    await createTestPayment(due.id, 8500);

    await reminderService.processDailyReminders(new Date("2026-07-05"));

    const logsCount = await prisma.reminder_logs.count({ where: { tenant_id: tenant.id } });
    expect(logsCount).toBe(0);

    await verifyGlobalInvariants(tenant.id, owner.id, tenant.profile_id, hostel.id);
  });

  it("Scenario 3: Owner Dashboard stats check", async () => {
    const { owner, hostel, tenant, tenantProfile } = await createFixture();

    const due = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8500,
      total_amount: 8500,
      due_date: new Date("2026-07-05"),
      rent_month: new Date("2026-07-01"),
      status: "PAID",
    });
    await createTestPayment(due.id, 8500);

    vi.mocked(authService.getCurrentUser).mockResolvedValue({
      id: owner.id,
      email: owner.email,
      role: "OWNER",
    } as any);

    const req = new NextRequest(`http://localhost/api/dashboard/stats-shell?hostelId=${hostel.id}`, {
      headers: {
        "x-auth-mode": "legacy",
        "x-user-id": owner.id,
        "x-user-role": "OWNER",
        "x-owner-id": owner.id,
      },
    });

    const res = await getOwnerStatsShell(req);
    const stats = await res.json();
    expect(res.status).toBe(200);

    expect(Number(stats.pending_total || 0)).toBe(0);
    expect(Number(stats.unpaid_tenant_count || 0)).toBe(0);

    await verifyGlobalInvariants(tenant.id, owner.id, tenant.profile_id, hostel.id);
  });

  it("Scenario 4: Tenant Portal stats/widgets check", async () => {
    const { owner, hostel, tenant, tenantProfile } = await createFixture();

    const due = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8500,
      total_amount: 8500,
      due_date: new Date("2026-07-05"),
      rent_month: new Date("2026-07-01"),
      status: "PAID",
    });
    await createTestPayment(due.id, 8500);

    vi.mocked(authService.getCurrentUser).mockResolvedValue({
      id: tenant.profile_id,
      email: tenantProfile.email,
      role: "TENANT",
    } as any);

    const req = new NextRequest(`http://localhost/api/dashboard/tenant/stats`, {
      headers: {
        "x-auth-mode": "legacy",
        "x-user-id": tenant.profile_id,
        "x-user-role": "TENANT",
        "x-tenant-id": tenant.id,
      },
    });

    const res = await getTenantStats(req);
    const stats = await res.json();
    expect(res.status).toBe(200);

    expect(Number(stats.pending_dues || 0)).toBe(0);

    await verifyGlobalInvariants(tenant.id, owner.id, tenant.profile_id, hostel.id);
  });

  it("Scenario 5: Multi-month FIFO allocation without remainder", async () => {
    const { owner, hostel, tenant, tenantProfile } = await createFixture();

    const dueJuly = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8500,
      total_amount: 8500,
      due_date: new Date("2026-07-05"),
      rent_month: new Date("2026-07-01"),
      status: "UPCOMING",
    });

    const dueAug = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8500,
      total_amount: 8500,
      due_date: new Date("2026-08-05"),
      rent_month: new Date("2026-08-01"),
      status: "UPCOMING",
    });

    const jti = await createTestIdentityToken(owner.id);

    vi.mocked(authService.getCurrentUser).mockResolvedValue({
      id: owner.id,
      email: owner.email,
      role: "OWNER",
    } as any);

    const req = new NextRequest("http://localhost/api/payments/record-offline", {
      method: "POST",
      headers: {
        "x-auth-mode": "legacy",
        "x-user-id": owner.id,
        "x-user-role": "OWNER",
        "x-owner-id": owner.id,
      },
      body: JSON.stringify({
        identity_token: jti,
        tenant_id: tenant.id,
        amount_paid: 17000,
        payment_method: "CASH",
      }),
    });

    const res = await recordOffline(req);
    const json = await res.json();
    expect(res.status).toBe(200);

    const obJuly = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: dueJuly.id } });
    const obAug = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: dueAug.id } });
    expect(obJuly.status).toBe("PAID");
    expect(obAug.status).toBe("PAID");

    const ledger = await tenantFinancialLedgerService.getBalance(tenant.id, owner.id);
    expect(ledger.future_rent_credit).toBe(0);

    await verifyGlobalInvariants(tenant.id, owner.id, tenant.profile_id, hostel.id);
  });

  it("Scenario 6: Multi-month FIFO allocation with credit remainder", async () => {
    const { owner, hostel, tenant, tenantProfile } = await createFixture();

    const dueJuly = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8500,
      total_amount: 8500,
      due_date: new Date("2026-07-05"),
      rent_month: new Date("2026-07-01"),
      status: "UPCOMING",
    });

    const dueAug = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8500,
      total_amount: 8500,
      due_date: new Date("2026-08-05"),
      rent_month: new Date("2026-08-01"),
      status: "UPCOMING",
    });

    vi.mocked(authService.getCurrentUser).mockResolvedValue({
      id: tenant.profile_id,
      email: tenantProfile.email,
      role: "TENANT",
    } as any);

    const reqIntent = new NextRequest("http://localhost/api/payments/create-intent", {
      method: "POST",
      headers: {
        "x-auth-mode": "legacy",
        "x-user-id": tenant.profile_id,
        "x-user-role": "TENANT",
        "x-tenant-id": tenant.id,
        "x-user-email": tenantProfile.email,
      },
      body: JSON.stringify({
        payment_type: "RENT",
        amount: 25500,
        tenant_id: tenant.id,
      }),
    });

    const resIntent = await createPaymentIntent(reqIntent);
    const jsonIntent = await resIntent.json();
    expect(resIntent.status).toBe(200);

    const merchantTxnId = jsonIntent.merchant_txn_id;
    const resWebhook = await fireRazorpayWebhook(merchantTxnId, 25500, tenant.id);
    expect(resWebhook.status).toBe(200);

    const obJuly = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: dueJuly.id } });
    const obAug = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: dueAug.id } });
    expect(obJuly.status).toBe("PAID");
    expect(obAug.status).toBe("PAID");

    const ledger = await tenantFinancialLedgerService.getBalance(tenant.id, owner.id);
    expect(ledger.future_rent_credit).toBe(8500);

    await verifyGlobalInvariants(tenant.id, owner.id, tenant.profile_id, hostel.id);
  });

  it("Scenario 7: Credit auto-settlement upon rent generation", async () => {
    const { owner, hostel, tenant, tenantProfile } = await createFixture();

    // Top up future rent credit directly
    await prisma.$transaction(async (tx) => {
      await tenantFinancialLedgerService.creditIdempotentInTx(tx, {
        tenantId: tenant.id,
        ownerId: owner.id,
        createdBy: owner.id,
        amount: 8500,
        referenceId: crypto.randomUUID(),
        referenceType: "PAYMENT_GROUP_REMAINDER",
        reason: "FUTURE_RENT_CREDIT_TOPUP",
      });
    });

    const dueSept = await prisma.rent_obligations.create({
      data: {
        tenant_id: tenant.id,
        owner_id: owner.id,
        hostel_id: hostel.id,
        obligation_type: "RENT",
        amount: 8500,
        total_amount: 8500,
        rent_month: new Date("2026-09-01"),
        due_date: new Date("2026-09-05"),
        status: "UPCOMING",
      },
    });

    const { eventSystem } = await import("@/lib/events");
    await eventSystem.trigger("obligation_created", {
      tenant_id: tenant.id,
      owner_id: owner.id,
      hostel_id: hostel.id,
      source: "rent_generation",
    });

    // Ensure the database auto-settlement is fully applied synchronously for the test
    const { financialPaymentFacade } = await import("@/src/services/payments/financial-payment-facade");
    await prisma.$transaction(async (tx) => {
      await financialPaymentFacade.applyAvailableCredits(tx, {
        tenantId: tenant.id,
        hostelId: hostel.id,
        ownerId: owner.id,
        actorId: owner.id,
      });
    });

    const obSept = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: dueSept.id } });
    expect(obSept.status).toBe("PAID");

    const ledger = await tenantFinancialLedgerService.getBalance(tenant.id, owner.id);
    expect(ledger.future_rent_credit).toBe(0);

    await verifyGlobalInvariants(tenant.id, owner.id, tenant.profile_id, hostel.id);
  });

  it("Scenario 8: Webhook idempotency", async () => {
    const { owner, hostel, tenant, tenantProfile } = await createFixture();

    const due = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8500,
      total_amount: 8500,
      due_date: new Date("2026-07-05"),
      rent_month: new Date("2026-07-01"),
      status: "UPCOMING",
    });

    vi.mocked(authService.getCurrentUser).mockResolvedValue({
      id: tenant.profile_id,
      email: tenantProfile.email,
      role: "TENANT",
    } as any);

    const reqIntent = new NextRequest("http://localhost/api/payments/create-intent", {
      method: "POST",
      headers: {
        "x-auth-mode": "legacy",
        "x-user-id": tenant.profile_id,
        "x-user-role": "TENANT",
        "x-tenant-id": tenant.id,
        "x-user-email": tenantProfile.email,
      },
      body: JSON.stringify({
        payment_type: "RENT",
        amount: 8500,
        tenant_id: tenant.id,
      }),
    });

    const resIntent = await createPaymentIntent(reqIntent);
    const jsonIntent = await resIntent.json();
    const merchantTxnId = jsonIntent.merchant_txn_id;

    const payId = `pay_${crypto.randomBytes(4).toString("hex")}`;

    // Delivery 1
    const res1 = await fireRazorpayWebhook(merchantTxnId, 8500, tenant.id, payId);
    expect(res1.status).toBe(200);

    // Delivery 2 (Duplicate)
    const res2 = await fireRazorpayWebhook(merchantTxnId, 8500, tenant.id, payId);
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.duplicate).toBe(true);

    const ob = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: due.id } });
    expect(ob.status).toBe("PAID");

    const ledger = await tenantFinancialLedgerService.getBalance(tenant.id, owner.id);
    expect(ledger.future_rent_credit).toBe(0);

    await verifyGlobalInvariants(tenant.id, owner.id, tenant.profile_id, hostel.id);
  });

  it("Scenario 9: Concurrent payments serialization", async () => {
    const { owner, hostel, tenant, tenantProfile } = await createFixture();

    const due = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8500,
      total_amount: 8500,
      due_date: new Date("2026-07-05"),
      rent_month: new Date("2026-07-01"),
      status: "UPCOMING",
    });

    vi.mocked(authService.getCurrentUser).mockResolvedValue({
      id: tenant.profile_id,
      email: tenantProfile.email,
      role: "TENANT",
    } as any);

    // Manually create two distinct payment attempts for the same tenant to simulate concurrent payments
    const txnId1 = `hms_rent_${crypto.randomBytes(6).toString("hex")}`;
    const orderId1 = `order_${crypto.randomBytes(4).toString("hex")}`;
    await prisma.paymentAttempt.create({
      data: {
        id: crypto.randomUUID(),
        tenant_id: tenant.id,
        owner_id: owner.id,
        hostel_id: hostel.id,
        flow_type: "RENT",
        payment_type: "RENT",
        provider: "RAZORPAY",
        amount: 8500,
        status: "CREATED",
        merchant_txn_id: txnId1,
        checkout_url: "http://localhost/checkout/mock",
        gateway_txn_id: orderId1,
        provider_order_id: orderId1,
        provider_reference_id: orderId1,
        raw_create_response: { id: orderId1 },
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const txnId2 = `hms_rent_${crypto.randomBytes(6).toString("hex")}`;
    const orderId2 = `order_${crypto.randomBytes(4).toString("hex")}`;
    await prisma.paymentAttempt.create({
      data: {
        id: crypto.randomUUID(),
        tenant_id: tenant.id,
        owner_id: owner.id,
        hostel_id: hostel.id,
        flow_type: "RENT",
        payment_type: "RENT",
        provider: "RAZORPAY",
        amount: 8500,
        status: "CREATED",
        merchant_txn_id: txnId2,
        checkout_url: "http://localhost/checkout/mock",
        gateway_txn_id: orderId2,
        provider_order_id: orderId2,
        provider_reference_id: orderId2,
        raw_create_response: { id: orderId2 },
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    // Fire webhook calls concurrently
    const p1 = fireRazorpayWebhook(txnId1, 8500, tenant.id);
    const p2 = fireRazorpayWebhook(txnId2, 8500, tenant.id);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const ob = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: due.id } });
    expect(ob.status).toBe("PAID");

    const ledger = await tenantFinancialLedgerService.getBalance(tenant.id, owner.id);
    expect(ledger.future_rent_credit).toBe(8500);

    await verifyGlobalInvariants(tenant.id, owner.id, tenant.profile_id, hostel.id);
  });

  it("Scenario 10: Month boundary transitions", async () => {
    const { owner, hostel, tenant, tenantProfile } = await createFixture();

    const due = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8500,
      total_amount: 8500,
      due_date: new Date("2026-07-05"),
      rent_month: new Date("2026-07-01"),
      status: "UPCOMING",
    });

    // 1. June 30 sync
    const resJune = await agreementRentScheduleService.syncDueStatuses({
      hostelId: hostel.id,
      now: new Date("2026-06-30"),
    });
    const obJune = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: due.id } });
    expect(obJune.status).toBe("UPCOMING");
    expect(resJune.pending).toBe(0);
    expect(resJune.overdue).toBe(0);

    // 2. July 1 sync
    const resJuly1 = await agreementRentScheduleService.syncDueStatuses({
      hostelId: hostel.id,
      now: new Date("2026-07-01"),
    });
    const obJuly1 = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: due.id } });
    expect(obJuly1.status).toBe("PENDING");
    expect(resJuly1.pending).toBe(1);
    expect(resJuly1.overdue).toBe(0);

    // 3. July 6 sync
    const resJuly6 = await agreementRentScheduleService.syncDueStatuses({
      hostelId: hostel.id,
      now: new Date("2026-07-06"),
    });
    expect(resJuly6.overdue).toBe(1);
  });

  it("Scenario 11: Zero amount validation", async () => {
    const { owner, hostel, tenant, tenantProfile } = await createFixture();

    vi.mocked(authService.getCurrentUser).mockResolvedValue({
      id: tenant.profile_id,
      email: tenantProfile.email,
      role: "TENANT",
    } as any);

    // Intent check
    const reqIntent = new NextRequest("http://localhost/api/payments/create-intent", {
      method: "POST",
      headers: {
        "x-auth-mode": "legacy",
        "x-user-id": tenant.profile_id,
        "x-user-role": "TENANT",
        "x-tenant-id": tenant.id,
        "x-user-email": tenantProfile.email,
      },
      body: JSON.stringify({
        payment_type: "RENT",
        amount: 0,
        tenant_id: tenant.id,
      }),
    });
    const resIntent = await createPaymentIntent(reqIntent);
    expect(resIntent.status).toBe(400);

    // Offline check
    const jti = await createTestIdentityToken(owner.id);

    vi.mocked(authService.getCurrentUser).mockResolvedValue({
      id: owner.id,
      email: owner.email,
      role: "OWNER",
    } as any);

    const reqOffline = new NextRequest("http://localhost/api/payments/record-offline", {
      method: "POST",
      headers: {
        "x-auth-mode": "legacy",
        "x-user-id": owner.id,
        "x-user-role": "OWNER",
        "x-owner-id": owner.id,
      },
      body: JSON.stringify({
        identity_token: jti,
        tenant_id: tenant.id,
        amount_paid: 0,
        payment_method: "CASH",
      }),
    });
    const resOffline = await recordOffline(reqOffline);
    expect(resOffline.status).toBe(400);
  });

  it("Scenario 12: Excess offline payment handling", async () => {
    const { owner, hostel, tenant, tenantProfile } = await createFixture();

    // Two obligations so Case A's and Case B's overflow-to-credit effects
    // don't compound onto the same row — each case is asserted independently.
    const dueA = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8500,
      total_amount: 8500,
      due_date: new Date("2026-07-05"),
      rent_month: new Date("2026-07-01"),
      status: "UPCOMING",
    });
    const dueB = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8500,
      total_amount: 8500,
      due_date: new Date("2026-08-05"),
      rent_month: new Date("2026-08-01"),
      status: "UPCOMING",
    });

    const jtiA = await createTestIdentityToken(owner.id);
    const jtiB = await createTestIdentityToken(owner.id);

    vi.mocked(authService.getCurrentUser).mockResolvedValue({
      id: owner.id,
      email: owner.email,
      role: "OWNER",
    } as any);

    // Case A: Specific obligation_id with an excess amount now succeeds and
    // credits the excess as future rent credit — the single-obligation path
    // routes through the same Planner->Engine flow as every other settlement
    // path (previously rejected outright by the retired _applyPaymentInTx).
    const reqOfflineA = new NextRequest("http://localhost/api/payments/record-offline", {
      method: "POST",
      headers: {
        "x-auth-mode": "legacy",
        "x-user-id": owner.id,
        "x-user-role": "OWNER",
        "x-owner-id": owner.id,
      },
      body: JSON.stringify({
        identity_token: jtiA,
        obligation_id: dueA.id,
        amount_paid: 9000,
        payment_method: "CASH",
      }),
    });
    const resOfflineA = await recordOffline(reqOfflineA);
    expect(resOfflineA.status).toBe(200);

    const obA = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: dueA.id } });
    expect(obA.status).toBe("PAID");

    const ledgerAfterA = await tenantFinancialLedgerService.getBalance(tenant.id, owner.id);
    expect(ledgerAfterA.future_rent_credit).toBe(500);

    // Case B: Only tenant_id and excess amount -> Should succeed and go to credit
    const reqOfflineB = new NextRequest("http://localhost/api/payments/record-offline", {
      method: "POST",
      headers: {
        "x-auth-mode": "legacy",
        "x-user-id": owner.id,
        "x-user-role": "OWNER",
        "x-owner-id": owner.id,
      },
      body: JSON.stringify({
        identity_token: jtiB,
        tenant_id: tenant.id,
        amount_paid: 9000,
        payment_method: "CASH",
      }),
    });
    const resOfflineB = await recordOffline(reqOfflineB);
    expect(resOfflineB.status).toBe(200);

    const obB = await prisma.rent_obligations.findUniqueOrThrow({ where: { id: dueB.id } });
    expect(obB.status).toBe("PAID");

    const ledger = await tenantFinancialLedgerService.getBalance(tenant.id, owner.id);
    expect(ledger.future_rent_credit).toBe(1000);

    await verifyGlobalInvariants(tenant.id, owner.id, tenant.profile_id, hostel.id);
  });
});
