import { describe, expect, it, vi, beforeEach } from "vitest";
import { RazorpayProvider } from "@/src/services/payments/providers/razorpay";
import { PaymentService } from "@/src/services/payments/payment-service";
import { prisma } from "@/lib/db";
import axios from "axios";
import * as crypto from "crypto";

vi.mock("axios");
vi.mock("@/lib/db", () => {
  return {
    prisma: {
      paymentAttempt: {
        findFirst: vi.fn(),
        updateMany: vi.fn(),
      },
      tenants: {
        findUnique: vi.fn(),
      },
      paymentProviderVerificationSnapshot: {
        create: vi.fn(),
      },
      paymentStatusEvent: {
        create: vi.fn(),
      },
      paymentWebhookEvent: {
        update: vi.fn(),
      },
    },
  };
});

describe("RazorpayProvider", () => {
  const config = {
    key_id: "rzp_test_key",
    key_secret: "rzp_test_secret",
    webhook_secret: "rzp_test_webhook_secret",
    base_url: "https://api.razorpay.com",
    currency: "INR",
  };

  let provider: RazorpayProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new RazorpayProvider(config);
  });

  describe("createIntent", () => {
    it("should successfully create a payment intent and format amount to paise", async () => {
      const mockOrderResponse = {
        data: {
          id: "order_mock123",
          entity: "order",
          amount: 50000,
          currency: "INR",
          receipt: "txn_receipt_001",
          status: "created",
        },
      };
      vi.mocked(axios.post).mockResolvedValueOnce(mockOrderResponse);

      const result = await provider.createIntent({
        amount: 500, // ₹500
        merchant_txn_id: "txn_receipt_001",
        tenant_name: "John Doe",
        tenant_email: "john@example.com",
        tenant_phone: "919999999999",
      });

      expect(axios.post).toHaveBeenCalledWith(
        "https://api.razorpay.com/v1/orders",
        {
          amount: 50000,
          currency: "INR",
          receipt: "txn_receipt_001",
          notes: {
            merchant_txn_id: "txn_receipt_001",
            flow_type: "",
            hostel_id: "",
            tenant_name: "John Doe",
            tenant_email: "john@example.com",
            tenant_phone: "919999999999",
            tenant_id: "",
          },
        },
        {
          auth: {
            username: "rzp_test_key",
            password: "rzp_test_secret",
          },
        }
      );

      expect(result).toEqual({
        provider: "RAZORPAY",
        merchant_txn_id: "txn_receipt_001",
        checkout_url: null,
        upi_intent_url: null,
        qr_payload: null,
        expires_at: null,
        gateway_txn_id: "order_mock123",
        provider_order_id: "order_mock123",
        provider_transaction_id: null,
        provider_reference_id: "order_mock123",
        raw_response: {
          ...mockOrderResponse.data,
          key_id: "rzp_test_key",
        },
      });
    });
  });

  describe("verifyWebhook", () => {
    it("should verify webhook signature and return mapped status", async () => {
      const webhookPayload = {
        event: "order.paid",
        payload: {
          order: {
            entity: {
              id: "order_mock123",
              receipt: "txn_receipt_001",
              status: "paid",
              amount: 50000,
            },
          },
        },
      };

      const payloadString = JSON.stringify(webhookPayload);
      const signature = crypto
        .createHmac("sha256", "rzp_test_webhook_secret")
        .update(payloadString)
        .digest("hex");

      const result = await provider.verifyWebhook(
        { "x-razorpay-signature": signature },
        payloadString
      );

      expect(result.status).toBe("SUCCESS");
      expect(result.merchant_txn_id).toBe("txn_receipt_001");
      expect(result.amount).toBe(500);
    });

    it("should NOT throw error if signature is invalid (handled at route level)", async () => {
      const webhookPayload = { event: "order.paid" };
      const result = await provider.verifyWebhook(
        { "x-razorpay-signature": "wrong_signature" },
        JSON.stringify(webhookPayload)
      );
      expect(result.verification_state).toBe("SIGNED");
    });
  });

  describe("fetchStatus", () => {
    it("should fetch status of order and correct payment status", async () => {
      vi.mocked(axios.get).mockImplementation((url: string) => {
        if (url.includes("/v1/orders/order_mock123/payments")) {
          return Promise.resolve({
            data: {
              items: [
                {
                  id: "pay_mock123",
                  status: "captured",
                  amount: 50000,
                },
              ],
            },
          } as any);
        } else if (url.includes("/v1/orders/order_mock123")) {
          return Promise.resolve({
            data: {
              id: "order_mock123",
              status: "paid",
              amount: 50000,
              receipt: "txn_receipt_001",
            },
          } as any);
        }
        return Promise.reject(new Error("Not found"));
      });

      const result = await provider.fetchStatus("txn_receipt_001", "order_mock123");

      expect(result.status).toBe("SUCCESS");
      expect(result.provider_order_id).toBe("order_mock123");
      expect(result.provider_transaction_id).toBe("pay_mock123");
    });
  });
});
