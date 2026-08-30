import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET, POST } from "../app/api/payments/pay/[token]/route";
import { NextRequest } from "next/server";
import { financialPaymentFacade } from "../src/services/payments/financial-payment-facade";

const mocks = vi.hoisted(() => {
  return {
    prisma: {
      payment_link_tokens: {
        findUnique: vi.fn(),
        create: vi.fn(),
        findFirst: vi.fn(),
      },
      rent_obligations: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      tenants: {
        findUnique: vi.fn(),
      },
    },
    paymentService: {
      createMultiObligationPaymentIntent: vi.fn(),
      createAmountPaymentIntent: vi.fn(),
    },
    financialPaymentFacade: {
      previewSettlement: vi.fn(),
    },
    getSession: vi.fn(),
    resolveOwnerScope: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/src/services/payments/payment-service", () => ({
  paymentService: mocks.paymentService,
}));
vi.mock("@/src/services/payments/financial-payment-facade", () => ({
  financialPaymentFacade: mocks.financialPaymentFacade,
}));
vi.mock("@/src/services/payments/merchant-context", () => ({
  getProviderContext: vi.fn().mockResolvedValue({
    provider: "RAZORPAY",
    config: {
      key_id: "rzp_test_mockkey12345",
      key_secret: "mocksecret",
    }
  }),
}));
vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));
vi.mock("@/lib/auth/resolve-operational-scope", () => ({
  resolveOwnerScope: mocks.resolveOwnerScope,
}));
vi.mock("@/lib/logger", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("Payment Link Token Public Flow", () => {
  const mockToken = "12345678-1234-1234-1234-1234567890ab";

  describe("GET /api/payments/pay/[token]", () => {
    it("returns 404 when token is not found", async () => {
      mocks.prisma.payment_link_tokens.findUnique.mockResolvedValueOnce(null);

      const request = new NextRequest(`http://localhost/api/payments/pay/${mockToken}`);
      const response = await GET(request, { params: Promise.resolve({ token: mockToken }) });

      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toContain("Payment Not Found");
    });

    it("returns 410 when token has expired", async () => {
      mocks.prisma.payment_link_tokens.findUnique.mockResolvedValueOnce({
        token: mockToken,
        expires_at: new Date(Date.now() - 1000), // Expired
        rent_obligations: { status: "PENDING", amount: 5000, rent_month: new Date() },
        tenants: { profiles: { name: "John Doe" } },
        hostels: {
          name: "Sunrise Hostel",
          phone: "1234567890",
          address: "123 Main St",
          city: "Hyderabad",
          state: "Telangana",
          pincode: "500081",
          logo_url: "https://example.com/logo.png"
        },
      });

      const request = new NextRequest(`http://localhost/api/payments/pay/${mockToken}`);
      const response = await GET(request, { params: Promise.resolve({ token: mockToken }) });

      expect(response.status).toBe(410);
      const text = await response.text();
      expect(text).toContain("Payment Link Expired");
    });

    it("returns 200 with a pre-filled amount even if the hinted obligation is already paid (pay-ahead)", async () => {
      mocks.prisma.payment_link_tokens.findUnique.mockResolvedValueOnce({
        token: mockToken,
        tenant_id: "tenant-1",
        hostel_id: "hostel-1",
        expires_at: new Date(Date.now() + 100000),
        rent_obligations: { status: "PAID", amount: 5000, rent_month: new Date(), payments: [] },
        tenants: { profiles: { name: "John Doe" }, monthly_rent: 5000 },
        hostels: {
          name: "Sunrise Hostel",
          phone: "1234567890",
          address: "123 Main St",
          city: "Hyderabad",
          state: "Telangana",
          pincode: "500081",
          logo_url: "https://example.com/logo.png"
        },
      });

      // No other obligations due — getTenantDues() sees nothing outstanding.
      mocks.prisma.rent_obligations.findMany.mockResolvedValueOnce([]);

      const request = new NextRequest(`http://localhost/api/payments/pay/${mockToken}`);
      const response = await GET(request, { params: Promise.resolve({ token: mockToken }) });

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('id="amount-input"');
      // Nothing due — leave the field at 0 rather than pre-filling monthly
      // rent, so the payer types whatever they actually want to pay ahead.
      expect(text).toContain('value="0"');
      expect(text).toContain("Proceed to Secure Payment");
    });

    it("pre-fills only what's actually due today or overdue, not the full remaining-lease total", async () => {
      mocks.prisma.payment_link_tokens.findUnique.mockResolvedValueOnce({
        token: mockToken,
        tenant_id: "tenant-1",
        hostel_id: "hostel-1",
        expires_at: new Date(Date.now() + 100000),
        rent_obligations: null, // generic tenant-scoped link, no specific obligation hinted
        tenants: { profiles: { name: "John Doe" }, monthly_rent: 8500 },
        hostels: {
          name: "Sunrise Hostel",
          phone: "1234567890",
          address: "123 Main St",
          city: "Hyderabad",
          state: "Telangana",
          pincode: "500081",
          logo_url: "https://example.com/logo.png"
        },
      });

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      // Overdue current-cycle rent, plus next month's rent already activated
      // early (status PENDING despite a future due_date) so the tenant *can*
      // prepay it — the pre-filled amount must only reflect the overdue one.
      mocks.prisma.rent_obligations.findMany.mockResolvedValueOnce([
        {
          id: "ob-overdue", tenant_id: "tenant-1", obligation_type: "RENT",
          rent_month: yesterday, due_date: yesterday, amount: 8500, total_amount: 8500,
          late_fee: 0, status: "PENDING", payments: [], room_allocations: null,
        },
        {
          id: "ob-future", tenant_id: "tenant-1", obligation_type: "RENT",
          rent_month: nextMonth, due_date: nextMonth, amount: 8500, total_amount: 8500,
          late_fee: 0, status: "PENDING", payments: [], room_allocations: null,
        },
      ]);

      const request = new NextRequest(`http://localhost/api/payments/pay/${mockToken}`);
      const response = await GET(request, { params: Promise.resolve({ token: mockToken }) });

      expect(response.status).toBe(200);
      const text = await response.text();
      // Must be 8500 (the overdue installment only), never 17000 (both installments).
      expect(text).toContain('value="8500"');
      expect(text).not.toContain('value="17000"');
    });

    it("returns 200 with DUE status and payment button if obligation is pending", async () => {
      mocks.prisma.payment_link_tokens.findUnique.mockResolvedValueOnce({
        token: mockToken,
        expires_at: new Date(Date.now() + 100000),
        rent_obligations: { status: "PENDING", amount: 5000, rent_month: new Date(), payments: [] },
        tenants: { profiles: { name: "John Doe" }, monthly_rent: 5000 },
        hostels: {
          name: "Sunrise Hostel",
          phone: "1234567890",
          address: "123 Main St",
          city: "Hyderabad",
          state: "Telangana",
          pincode: "500081",
          logo_url: "https://example.com/logo.png"
        },
      });

      const request = new NextRequest(`http://localhost/api/payments/pay/${mockToken}`);
      const response = await GET(request, { params: Promise.resolve({ token: mockToken }) });

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('id="amount-input"');
      expect(text).toContain('value="5000"');
      expect(text).toContain("Proceed to Secure Payment");
    });

    it("returns 200 with DUE status when token has recoverable prefix or is URL encoded", async () => {
      mocks.prisma.payment_link_tokens.findUnique.mockResolvedValue({
        token: mockToken,
        expires_at: new Date(Date.now() + 100000),
        rent_obligations: { status: "PENDING", amount: 5000, rent_month: new Date(), payments: [] },
        tenants: { profiles: { name: "John Doe" }, monthly_rent: 5000 },
        hostels: {
          name: "Sunrise Hostel",
          phone: "1234567890",
          address: "123 Main St",
          city: "Hyderabad",
          state: "Telangana",
          pincode: "500081",
          logo_url: "https://example.com/logo.png"
        },
      });

      const recoverableTokens = [
        `extra${mockToken}`,
        `{{1}}${mockToken}`,
        `%7B%7B1%7D%7D${mockToken}`,
        `%7B%7B%7B%7D%7Td${mockToken}`,
      ];

      for (const token of recoverableTokens) {
        const request = new NextRequest(`http://localhost/api/payments/pay/${token}`);
        const response = await GET(request, { params: Promise.resolve({ token }) });

        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toContain('id="amount-input"');
      }
    });

    it("returns 404 and does not query Prisma for unrecoverable/garbage tokens", async () => {
      mocks.prisma.payment_link_tokens.findUnique.mockClear();

      const garbageTokens = [
        "garbageuuid",
        "random-text-1234",
        "uuidgarbage",
        `${mockToken}extra`,
      ];

      for (const token of garbageTokens) {
        const request = new NextRequest(`http://localhost/api/payments/pay/${token}`);
        const response = await GET(request, { params: Promise.resolve({ token }) });

        expect(response.status).toBe(404);
        const text = await response.text();
        expect(text).toContain("Payment Not Found");
      }

      expect(mocks.prisma.payment_link_tokens.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/payments/pay/[token]", () => {
    it("returns JSON with success and attempt when payment attempt is successfully created/reused", async () => {
      mocks.prisma.payment_link_tokens.findUnique.mockResolvedValueOnce({
        token: mockToken,
        expires_at: new Date(Date.now() + 100000),
        obligation_id: "ob-1",
        tenant_id: "tenant-1",
        hostel_id: "hostel-1",
        owner_id: "owner-1",
        rent_obligations: { status: "PENDING", amount: 5000 },
        tenants: { profiles: { name: "John Doe", email: "j@example.com" } },
        hostels: {
          name: "Sunrise Hostel",
          phone: "1234567890",
          address: "123 Main St",
          city: "Hyderabad",
          state: "Telangana",
          pincode: "500081",
          logo_url: "https://example.com/logo.png"
        },
      });

      mocks.paymentService.createAmountPaymentIntent.mockResolvedValueOnce({
        id: "attempt-123",
        amount: 5000,
        status: "PENDING",
        raw_response: { key_id: "rzp_test", amount: 500000, currency: "INR" },
        gateway_txn_id: "order_123",
      } as any);

      const request = new NextRequest(`http://localhost/api/payments/pay/${mockToken}`, {
        method: "POST",
        body: JSON.stringify({ action: "initiate", amount: 5000 }),
      });
      const response = await POST(request, { params: Promise.resolve({ token: mockToken }) });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.attempt.id).toBe("attempt-123");
    });

    it("verifies payment signature when action is verify", async () => {
      mocks.prisma.payment_link_tokens.findUnique.mockResolvedValueOnce({
        token: mockToken,
        expires_at: new Date(Date.now() + 100000),
        obligation_id: "ob-1",
        tenant_id: "tenant-1",
        hostel_id: "hostel-1",
        owner_id: "owner-1",
        rent_obligations: { status: "PENDING", amount: 5000 },
        tenants: { profiles: { name: "John Doe" } },
        hostels: {
          name: "Sunrise Hostel",
          phone: "1234567890",
          address: "123 Main St",
          city: "Hyderabad",
          state: "Telangana",
          pincode: "500081",
          logo_url: "https://example.com/logo.png"
        },
      });

      const mockVerifyResult = {
        status: "SUCCESS",
        attempt: { id: "attempt-123", status: "SUCCESS" }
      };
      
      const verifySpy = vi.fn().mockResolvedValueOnce(mockVerifyResult);
      (mocks.paymentService as any).verifyPaymentStatus = verifySpy;

      const request = new NextRequest(`http://localhost/api/payments/pay/${mockToken}`, {
        method: "POST",
        body: JSON.stringify({
          action: "verify",
          attempt_id: "attempt-123",
          razorpay_payment_id: "pay-1",
          razorpay_order_id: "order-1",
          razorpay_signature: "sig-1"
        })
      });
      const response = await POST(request, { params: Promise.resolve({ token: mockToken }) });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.status).toBe("SUCCESS");
      expect(verifySpy).toHaveBeenCalledWith({
        userId: "owner-1",
        role: "OWNER",
        attemptId: "attempt-123",
        razorpay_payment_id: "pay-1",
        razorpay_order_id: "order-1",
        razorpay_signature: "sig-1"
      });
    });

    it("returns a settlement preview for a valid token and amount", async () => {
      mocks.prisma.payment_link_tokens.findUnique.mockResolvedValueOnce({
        token: mockToken,
        tenant_id: "tenant-1",
        hostel_id: "hostel-1",
        owner_id: "owner-1",
        obligation_id: null,
        expires_at: new Date(Date.now() + 1000 * 60 * 60),
        rent_obligations: null,
        hostels: { name: "Sunrise Hostel", phone: "1234567890" },
        tenants: { profiles: { name: "John Doe" } },
      });

      vi.mocked(financialPaymentFacade.previewSettlement).mockResolvedValueOnce({
        allocations: [],
        future_credit: 5000,
        total_outstanding: 0,
        total_to_settle: 0,
        remaining_outstanding: 0,
        minimum_allowed: 1,
        first_tier_label: "Future Rent Credit",
        payment_accepted: true,
        rejection_reason: null,
        payment_policy: "PARTIAL_ALLOWED",
        warnings: [],
        summary: "₹5,000 → credited as future rent",
        explanation: [],
        skipped_obligations: [],
        recommendation_score: 100,
      } as any);

      const request = new NextRequest(`http://localhost/api/payments/pay/${mockToken}`, {
        method: "POST",
        body: JSON.stringify({ action: "preview", amount: 5000 }),
      });
      const response = await POST(request, { params: Promise.resolve({ token: mockToken }) });
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.plan.future_credit).toBe(5000);
    });

    it("rejects a preview request with a non-positive amount", async () => {
      mocks.prisma.payment_link_tokens.findUnique.mockResolvedValueOnce({
        token: mockToken,
        tenant_id: "tenant-1",
        hostel_id: "hostel-1",
        owner_id: "owner-1",
        obligation_id: null,
        expires_at: new Date(Date.now() + 1000 * 60 * 60),
        rent_obligations: null,
        hostels: { name: "Sunrise Hostel", phone: "1234567890" },
        tenants: { profiles: { name: "John Doe" } },
      });

      const request = new NextRequest(`http://localhost/api/payments/pay/${mockToken}`, {
        method: "POST",
        body: JSON.stringify({ action: "preview", amount: 0 }),
      });
      const response = await POST(request, { params: Promise.resolve({ token: mockToken }) });

      expect(response.status).toBe(400);
    });

    it("initiates a payment for the payer-entered amount, not a fixed obligation balance", async () => {
      mocks.prisma.payment_link_tokens.findUnique.mockResolvedValueOnce({
        token: mockToken,
        tenant_id: "tenant-1",
        hostel_id: "hostel-1",
        owner_id: "owner-1",
        obligation_id: null,
        expires_at: new Date(Date.now() + 1000 * 60 * 60),
        rent_obligations: null,
        hostels: { name: "Sunrise Hostel", phone: "1234567890" },
        tenants: { profiles: { name: "John Doe", email: "j@example.com", phone: "9999999999" } },
      });

      vi.mocked(mocks.paymentService.createAmountPaymentIntent).mockResolvedValueOnce({
        id: "attempt-1",
        amount: 12000,
        status: "PENDING",
        raw_response: { key_id: "rzp_test", amount: 1200000, currency: "INR" },
        gateway_txn_id: "order_abc",
      } as any);

      const request = new NextRequest(`http://localhost/api/payments/pay/${mockToken}`, {
        method: "POST",
        body: JSON.stringify({ action: "initiate", amount: 12000 }),
      });
      const response = await POST(request, { params: Promise.resolve({ token: mockToken }) });
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(mocks.paymentService.createAmountPaymentIntent).toHaveBeenCalledWith(
        12000,
        "owner-1",
        "tenant-1",
        "hostel-1",
        expect.objectContaining({ source: "PAYMENT_LINK" })
      );
      expect(json.attempt.amount).toBe(12000);
    });

    it("rejects initiate with a missing or non-positive amount", async () => {
      mocks.prisma.payment_link_tokens.findUnique.mockResolvedValueOnce({
        token: mockToken,
        tenant_id: "tenant-1",
        hostel_id: "hostel-1",
        owner_id: "owner-1",
        obligation_id: null,
        expires_at: new Date(Date.now() + 1000 * 60 * 60),
        rent_obligations: null,
        hostels: { name: "Sunrise Hostel", phone: "1234567890" },
        tenants: { profiles: { name: "John Doe" } },
      });

      const request = new NextRequest(`http://localhost/api/payments/pay/${mockToken}`, {
        method: "POST",
        body: JSON.stringify({ action: "initiate" }),
      });
      const response = await POST(request, { params: Promise.resolve({ token: mockToken }) });

      expect(response.status).toBe(400);
    });

    it("returns 400 and does not query Prisma for unrecoverable/garbage tokens on POST", async () => {
      mocks.prisma.payment_link_tokens.findUnique.mockClear();

      const garbageTokens = [
        "garbageuuid",
        "random-text-1234",
        "uuidgarbage",
      ];

      for (const token of garbageTokens) {
        const request = new NextRequest(`http://localhost/api/payments/pay/${token}`, { method: "POST" });
        const response = await POST(request, { params: Promise.resolve({ token }) });

        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.success).toBe(false);
        expect(json.error).toBe("Invalid payment token format.");
      }

      expect(mocks.prisma.payment_link_tokens.findUnique).not.toHaveBeenCalled();
    });
  });
});

import { PaymentLinkService } from "../src/services/payments/payment-link-service";
import { POST as payLinkPOST } from "../app/api/payments/pay-link/route";

describe("PaymentLinkService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws error if neither tenantId nor obligationId is provided", async () => {
    await expect(PaymentLinkService.getOrCreateToken({})).rejects.toThrow("Either obligationId or tenantId must be provided");
  });

  it("returns existing non-expired token if found", async () => {
    const mockTokenRecord = { token: "token-123", expires_at: new Date(Date.now() + 100000) };
    mocks.prisma.payment_link_tokens.findFirst.mockResolvedValueOnce(mockTokenRecord);

    const result = await PaymentLinkService.getOrCreateToken({ obligationId: "ob-1", tenantId: "tenant-1" });
    expect(result.token).toBe("token-123");
    expect(mocks.prisma.payment_link_tokens.findFirst).toHaveBeenCalledWith({
      where: {
        obligation_id: "ob-1",
        tenant_id: "tenant-1",
        expires_at: { gt: expect.any(Date) },
      },
      orderBy: { created_at: "desc" },
    });
  });

  it("creates a tenant-scoped token (null obligation hint) without resolving an obligation", async () => {
    mocks.prisma.payment_link_tokens.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.tenants.findUnique.mockResolvedValueOnce({
      hostel_id: "hostel-1",
      owner_id: "owner-1",
    });
    mocks.prisma.payment_link_tokens.create.mockResolvedValueOnce({
      token: "new-token-456",
      expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });

    const result = await PaymentLinkService.getOrCreateToken({ tenantId: "tenant-1" });
    expect(result.token).toBe("new-token-456");
    // Per ADR-017, tenantId is no longer auto-resolved to an obligation: the
    // token is tenant-scoped with a null obligation hint, and the amount is
    // decided at payment time via buildSettlementPlan.
    expect(mocks.prisma.rent_obligations.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.payment_link_tokens.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenant_id: "tenant-1",
          hostel_id: "hostel-1",
          owner_id: "owner-1",
          obligation_id: null,
        }),
      })
    );
  });
});

describe("POST /api/payments/pay-link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 if session is missing or not OWNER", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const request = new NextRequest("http://localhost/api/payments/pay-link", {
      method: "POST",
      body: JSON.stringify({ tenantId: "tenant-1" }),
    });
    const response = await payLinkPOST(request);
    expect(response.status).toBe(403);
  });

  it("returns 400 if neither tenantId nor obligationId is provided", async () => {
    mocks.getSession.mockResolvedValueOnce({ role: "OWNER" });
    mocks.resolveOwnerScope.mockReturnValueOnce({ owner_id: "owner-1" });

    const request = new NextRequest("http://localhost/api/payments/pay-link", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const response = await payLinkPOST(request);
    expect(response.status).toBe(400);
  });

  it("returns 403 if tenant does not belong to owner", async () => {
    mocks.getSession.mockResolvedValueOnce({ role: "OWNER" });
    mocks.resolveOwnerScope.mockReturnValueOnce({ owner_id: "owner-1" });
    mocks.prisma.tenants.findUnique.mockResolvedValueOnce({ owner_id: "other-owner" });

    const request = new NextRequest("http://localhost/api/payments/pay-link", {
      method: "POST",
      body: JSON.stringify({ tenantId: "tenant-1" }),
    });
    const response = await payLinkPOST(request);
    expect(response.status).toBe(403);
  });

  it("returns canonical pay-link URL on success", async () => {
    mocks.getSession.mockResolvedValueOnce({ role: "OWNER" });
    mocks.resolveOwnerScope.mockReturnValueOnce({ owner_id: "owner-1" });
    // tenants.findUnique is called twice: once by the route's owner-auth check
    // (selects owner_id), once by PaymentLinkService (selects hostel_id/owner_id).
    mocks.prisma.tenants.findUnique.mockResolvedValue({ owner_id: "owner-1", hostel_id: "hostel-1" });

    // PaymentLinkService token creation (tenant-scoped, null obligation hint)
    mocks.prisma.payment_link_tokens.findFirst.mockResolvedValueOnce(null);
    mocks.prisma.payment_link_tokens.create.mockResolvedValueOnce({
      token: "mock-token-uuid-xyz",
      expires_at: new Date(),
    });

    const request = new NextRequest("http://localhost/api/payments/pay-link", {
      method: "POST",
      body: JSON.stringify({ tenantId: "tenant-1" }),
    });
    const response = await payLinkPOST(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.data.token).toBe("mock-token-uuid-xyz");
    expect(json.data.url).toContain("/pay/mock-token-uuid-xyz");
  });
});
