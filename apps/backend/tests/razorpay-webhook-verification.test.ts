import { describe, expect, it, vi, beforeEach } from "vitest";
import { paymentService } from "@/src/services/payments/payment-service";
import { prisma } from "@/lib/db";
import * as crypto from "crypto";

vi.mock("axios");
vi.mock("@/lib/db", () => {
  const mockAttempt = {
    id: "att_123",
    status: "PENDING",
    provider: "RAZORPAY",
    amount: "100.00",
    tenant_id: "tenant_abc",
    owner_id: "owner_xyz",
    hostel_id: "hostel_123",
    merchant_txn_id: "txn_001",
    gateway_txn_id: "order_mock123",
    provider_order_id: "order_mock123",
    payments: [],
  };

  const mockDb = {
    $transaction: vi.fn().mockImplementation((cb) => cb(mockDb)),
    $queryRaw: vi.fn().mockImplementation(() => Promise.resolve([{ next_sequence: 1 }])),
    $executeRaw: vi.fn().mockImplementation(() => Promise.resolve()),
    paymentAttempt: {
      findFirst: vi.fn().mockImplementation(() => Promise.resolve(mockAttempt)),
      findUnique: vi.fn().mockImplementation(() => Promise.resolve(mockAttempt)),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...mockAttempt, ...data })),
      updateMany: vi.fn().mockImplementation(() => Promise.resolve({ count: 1 })),
    },
    paymentAttemptStatusEvent: {
      create: vi.fn(),
      aggregate: vi.fn().mockImplementation(() => Promise.resolve({ _max: { sequence: 0 } })),
    },
    paymentProviderVerificationSnapshot: {
      create: vi.fn(),
    },
    paymentWebhookEvent: {
      create: vi.fn(),
      update: vi.fn(),
    },
    payments: {
      findFirst: vi.fn(),
    },
  };

  return {
    prisma: mockDb,
  };
});

describe("Razorpay Webhook and Verification Hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("verifyPaymentStatus", () => {
    it("should transition PENDING attempt to PENDING_VERIFICATION if fetchStatus returns PENDING", async () => {
      const mockAttempt = {
        id: "att_123",
        status: "PENDING",
        provider: "RAZORPAY",
        amount: "100.00",
        tenant_id: "tenant_abc",
        owner_id: "owner_xyz",
        hostel_id: "hostel_123",
        merchant_txn_id: "txn_001",
        gateway_txn_id: "order_mock123",
        provider_order_id: "order_mock123",
      };

      vi.mocked(prisma.paymentAttempt.findFirst).mockResolvedValueOnce(mockAttempt);
      vi.mocked(prisma.paymentAttempt.updateMany).mockResolvedValueOnce({ count: 1 });
      vi.mocked(prisma.paymentAttempt.findUnique).mockResolvedValue({
        ...mockAttempt,
        status: "PENDING_VERIFICATION",
      });

      const mockProviderInstance = {
        fetchStatus: vi.fn().mockResolvedValue({
          status: "PENDING",
          gateway_txn_id: "order_mock123",
          provider_order_id: "order_mock123",
          provider_transaction_id: "pay_mock123",
          provider_reference_id: "pay_mock123",
          provider_state: "attempted",
          raw_status: {},
        }),
      };

      vi.spyOn(paymentService as any, "getProviderInstanceForAttempt").mockResolvedValue({
        instance: mockProviderInstance,
        config: { key_secret: "rzp_test_secret" },
      });

      const signature = crypto
        .createHmac("sha256", "rzp_test_secret")
        .update("order_mock123|pay_mock123")
        .digest("hex");

      const result = await paymentService.verifyPaymentStatus({
        attemptId: "att_123",
        razorpay_payment_id: "pay_mock123",
        razorpay_order_id: "order_mock123",
        razorpay_signature: signature,
      });

      expect(result.status).toBe("PENDING_VERIFICATION");
      expect(mockProviderInstance.fetchStatus).toHaveBeenCalledWith("txn_001", "order_mock123");
    });

    it("should finalize inline and return SUCCESS if fetchStatus returns SUCCESS", async () => {
      const mockAttempt = {
        id: "att_123",
        status: "PENDING",
        provider: "RAZORPAY",
        amount: "100.00",
        tenant_id: "tenant_abc",
        owner_id: "owner_xyz",
        hostel_id: "hostel_123",
        merchant_txn_id: "txn_001",
        gateway_txn_id: "order_mock123",
        provider_order_id: "order_mock123",
      };

      vi.mocked(prisma.paymentAttempt.findFirst).mockResolvedValueOnce(mockAttempt);
      vi.mocked(prisma.paymentAttempt.updateMany).mockResolvedValueOnce({ count: 1 });
      vi.mocked(prisma.paymentAttempt.findUnique).mockResolvedValue({
        ...mockAttempt,
        status: "PENDING_VERIFICATION",
      });

      const mockProviderInstance = {
        fetchStatus: vi.fn().mockResolvedValue({
          status: "SUCCESS",
          gateway_txn_id: "order_mock123",
          provider_order_id: "order_mock123",
          provider_transaction_id: "pay_mock123",
          provider_reference_id: "pay_mock123",
          provider_state: "paid",
          raw_status: {},
        }),
      };

      vi.spyOn(paymentService as any, "getProviderInstanceForAttempt").mockResolvedValue({
        instance: mockProviderInstance,
        config: { key_secret: "rzp_test_secret" },
      });

      const finalizedAttempt = { ...mockAttempt, status: "SUCCESS" };
      const finalizeSpy = vi.spyOn(paymentService as any, "finalizePaymentAttempt").mockResolvedValue(finalizedAttempt);

      const signature = crypto
        .createHmac("sha256", "rzp_test_secret")
        .update("order_mock123|pay_mock123")
        .digest("hex");

      const result = await paymentService.verifyPaymentStatus({
        attemptId: "att_123",
        razorpay_payment_id: "pay_mock123",
        razorpay_order_id: "order_mock123",
        razorpay_signature: signature,
      });

      expect(result.status).toBe("SUCCESS");
      expect(finalizeSpy).toHaveBeenCalledWith("att_123", "SUCCESS", "pay_mock123", expect.any(Object));
    });

    it("should return PENDING_VERIFICATION if fetchStatus throws an error (fallback path)", async () => {
      const mockAttempt = {
        id: "att_123",
        status: "PENDING",
        provider: "RAZORPAY",
        amount: "100.00",
        tenant_id: "tenant_abc",
        owner_id: "owner_xyz",
        hostel_id: "hostel_123",
        merchant_txn_id: "txn_001",
        gateway_txn_id: "order_mock123",
        provider_order_id: "order_mock123",
      };

      vi.mocked(prisma.paymentAttempt.findFirst).mockResolvedValueOnce(mockAttempt);
      vi.mocked(prisma.paymentAttempt.updateMany).mockResolvedValueOnce({ count: 1 });
      vi.mocked(prisma.paymentAttempt.findUnique).mockResolvedValue({
        ...mockAttempt,
        status: "PENDING_VERIFICATION",
      });

      const mockProviderInstance = {
        fetchStatus: vi.fn().mockRejectedValue(new Error("API network error")),
      };

      vi.spyOn(paymentService as any, "getProviderInstanceForAttempt").mockResolvedValue({
        instance: mockProviderInstance,
        config: { key_secret: "rzp_test_secret" },
      });

      const signature = crypto
        .createHmac("sha256", "rzp_test_secret")
        .update("order_mock123|pay_mock123")
        .digest("hex");

      const result = await paymentService.verifyPaymentStatus({
        attemptId: "att_123",
        razorpay_payment_id: "pay_mock123",
        razorpay_order_id: "order_mock123",
        razorpay_signature: signature,
      });

      expect(result.status).toBe("PENDING_VERIFICATION");
    });

    it("should enforce replay protection by rejecting mismatching order ID", async () => {
      const mockAttempt = {
        id: "att_123",
        status: "PENDING",
        provider: "RAZORPAY",
        amount: "100.00",
        tenant_id: "tenant_abc",
        owner_id: "owner_xyz",
        hostel_id: "hostel_123",
        merchant_txn_id: "txn_001",
        gateway_txn_id: "order_mock123",
        provider_order_id: "order_mock123",
      };

      vi.mocked(prisma.paymentAttempt.findFirst).mockResolvedValueOnce(mockAttempt);
      vi.spyOn(paymentService as any, "getProviderInstanceForAttempt").mockResolvedValue({
        instance: {},
        config: { key_secret: "rzp_test_secret" },
      });

      const signature = crypto
        .createHmac("sha256", "rzp_test_secret")
        .update("order_different|pay_mock123")
        .digest("hex");

      await expect(
        paymentService.verifyPaymentStatus({
          attemptId: "att_123",
          razorpay_payment_id: "pay_mock123",
          razorpay_order_id: "order_different",
          razorpay_signature: signature,
        })
      ).rejects.toThrow("SECURITY_ERROR: razorpay_order_id mismatch");
    });
  });

  describe("handlePaymentWebhook", () => {
    it("should enforce strict order_id, amount, and tenant_id verification", async () => {
      const mockAttempt = {
        id: "att_123",
        status: "PENDING_VERIFICATION",
        provider: "RAZORPAY",
        amount: "100.00",
        tenant_id: "tenant_abc",
        owner_id: "owner_xyz",
        hostel_id: "hostel_123",
        merchant_txn_id: "txn_001",
        gateway_txn_id: "order_mock123",
        provider_order_id: "order_mock123",
      };

      vi.mocked(prisma.paymentAttempt.findFirst).mockResolvedValueOnce(mockAttempt);
      
      const mockProviderInstance = {
        verifyWebhook: vi.fn().mockResolvedValue({
          status: "SUCCESS",
          merchant_txn_id: "txn_001",
          provider_order_id: "order_mock123",
          gateway_txn_id: "order_mock123",
          amount: 100, // Matches 100.00
          tenant_id: "tenant_mismatch", // Mismatch!
          raw_event: {},
        }),
        fetchStatus: vi.fn().mockResolvedValue({
          status: "SUCCESS",
          provider_transaction_id: "pay_mock123",
          provider_order_id: "order_mock123",
          gateway_txn_id: "order_mock123",
          raw_status: {},
        }),
      };

      vi.spyOn(paymentService as any, "getProviderInstanceForAttempt").mockResolvedValue({
        instance: mockProviderInstance,
      });

      const mockBody = {
        payload: {
          payment: {
            entity: {
              notes: {
                merchant_txn_id: "txn_001"
              }
            }
          }
        }
      };

      await expect(
        paymentService.handlePaymentWebhook("RAZORPAY", {}, mockBody)
      ).rejects.toThrow("SECURITY_ERROR: Webhook tenant_id tenant_mismatch does not match DB tenant_abc");
    });
  });
});
