import crypto from "crypto";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  handleWhatsAppWebhookEvent,
  handleWhatsAppWebhookVerification,
  verifyMetaSignature,
} from "@/lib/services/notifications/whatsapp-webhook-handler";
import { whatsappWebhookEventService } from "@/lib/services/notifications/whatsapp-webhook-event-service";

vi.mock("@/lib/services/notifications/whatsapp-webhook-event-service", () => ({
  whatsappWebhookEventService: {
    recordReceived: vi.fn(),
    claimForProcessing: vi.fn(),
    processWebhookEvent: vi.fn(),
    markFailed: vi.fn(),
  },
}));

vi.mock("@/lib/services/rate-limit-service", () => ({
  rateLimitService: {
    checkStatelessLimit: vi.fn(async () => ({ allowed: true })),
  },
}));

vi.mock("@/lib/logger", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    metrics: vi.fn(),
  }),
}));

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "test-verify-token";

function sign(body: string, secret = APP_SECRET) {
  return `sha256=${crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function postRequest(body: string, signature: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature) headers["x-hub-signature-256"] = signature;
  return new NextRequest("https://api.yourstayo.com/api/webhooks/whatsapp", {
    method: "POST",
    headers,
    body,
  });
}

const STATUS_PAYLOAD = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba-1",
      changes: [
        {
          field: "messages",
          value: {
            statuses: [
              { id: "wamid.1", status: "delivered", timestamp: "1718000000", recipient_id: "917901070333" },
            ],
          },
        },
      ],
    },
  ],
});

/** Lets the fire-and-forget background processing settle before assertions. */
const flushBackground = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("WhatsApp webhook endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
    process.env.META_APP_SECRET = APP_SECRET;
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    delete process.env.WHATSAPP_APP_SECRET;

    vi.mocked(whatsappWebhookEventService.recordReceived).mockResolvedValue({
      event: { id: "event-1", processing_status: "RECEIVED", processing_result: null },
      duplicate: false,
      eventHash: "hash-1",
      payload: JSON.parse(STATUS_PAYLOAD),
    } as any);
    vi.mocked(whatsappWebhookEventService.claimForProcessing).mockResolvedValue(true);
    vi.mocked(whatsappWebhookEventService.processWebhookEvent).mockResolvedValue({
      status_events: 1,
      updated_logs: 1,
    } as any);
    vi.mocked(whatsappWebhookEventService.markFailed).mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    delete process.env.META_APP_SECRET;
  });

  describe("GET — subscription challenge", () => {
    it("echoes hub.challenge with 200 when the verify token matches", async () => {
      const req = new NextRequest(
        `https://api.yourstayo.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`
      );

      const res = await handleWhatsAppWebhookVerification(req);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("1158201444");
    });

    it("still accepts the legacy WHATSAPP_VERIFY_TOKEN name", async () => {
      delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
      process.env.WHATSAPP_VERIFY_TOKEN = "legacy-token";

      const req = new NextRequest(
        "https://api.yourstayo.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=legacy-token&hub.challenge=42"
      );

      const res = await handleWhatsAppWebhookVerification(req);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("42");
    });

    it("returns 403 for a wrong verify token", async () => {
      const req = new NextRequest(
        "https://api.yourstayo.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42"
      );

      const res = await handleWhatsAppWebhookVerification(req);

      expect(res.status).toBe(403);
    });

    it("returns 403 when hub.mode is not subscribe", async () => {
      const req = new NextRequest(
        `https://api.yourstayo.com/api/webhooks/whatsapp?hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=42`
      );

      const res = await handleWhatsAppWebhookVerification(req);

      expect(res.status).toBe(403);
    });

    it("returns 500 when no verify token is configured", async () => {
      delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

      const req = new NextRequest(
        "https://api.yourstayo.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=anything&hub.challenge=42"
      );

      const res = await handleWhatsAppWebhookVerification(req);

      expect(res.status).toBe(500);
    });
  });

  describe("POST — signature verification", () => {
    it("accepts a correctly signed body", () => {
      const result = verifyMetaSignature(STATUS_PAYLOAD, sign(STATUS_PAYLOAD));
      expect(result.verified).toBe(true);
    });

    it("rejects a body signed with the wrong secret", () => {
      const result = verifyMetaSignature(STATUS_PAYLOAD, sign(STATUS_PAYLOAD, "other-secret"));
      expect(result.verified).toBe(false);
      expect(result.failureReason).toBe("signature mismatch");
    });

    it("rejects a tampered body", () => {
      const signature = sign(STATUS_PAYLOAD);
      const result = verifyMetaSignature(STATUS_PAYLOAD.replace("delivered", "read"), signature);
      expect(result.verified).toBe(false);
    });

    it("falls back to the legacy WHATSAPP_APP_SECRET name", () => {
      delete process.env.META_APP_SECRET;
      process.env.WHATSAPP_APP_SECRET = "legacy-secret";

      const result = verifyMetaSignature(STATUS_PAYLOAD, sign(STATUS_PAYLOAD, "legacy-secret"));

      expect(result.verified).toBe(true);
      delete process.env.WHATSAPP_APP_SECRET;
    });

    it("returns 401 and never processes an unsigned request", async () => {
      const res = await handleWhatsAppWebhookEvent(postRequest(STATUS_PAYLOAD, null));
      await flushBackground();

      expect(res.status).toBe(401);
      expect(whatsappWebhookEventService.processWebhookEvent).not.toHaveBeenCalled();
      expect(whatsappWebhookEventService.markFailed).toHaveBeenCalledWith(
        "event-1",
        "missing x-hub-signature-256 header",
        "FAILED"
      );
    });

    it("records the rejected delivery for audit even though it is unsigned", async () => {
      await handleWhatsAppWebhookEvent(postRequest(STATUS_PAYLOAD, "sha256=deadbeef"));

      expect(whatsappWebhookEventService.recordReceived).toHaveBeenCalledWith(
        expect.objectContaining({ signatureVerified: false, signatureAlgorithm: "HMAC_SHA256" })
      );
    });

    it("returns 429 once the signature-failure rate limit trips", async () => {
      const { rateLimitService } = await import("@/lib/services/rate-limit-service");
      vi.mocked(rateLimitService.checkStatelessLimit).mockResolvedValueOnce({ allowed: false } as any);

      const res = await handleWhatsAppWebhookEvent(postRequest(STATUS_PAYLOAD, null));

      expect(res.status).toBe(429);
    });
  });

  describe("POST — acknowledgement and async processing", () => {
    it("returns 200 before the business logic finishes", async () => {
      let releaseProcessing: () => void = () => {};
      const processing = new Promise<void>((resolve) => {
        releaseProcessing = resolve;
      });
      vi.mocked(whatsappWebhookEventService.processWebhookEvent).mockImplementation(
        async () => {
          await processing;
          return { status_events: 1, updated_logs: 1 } as any;
        }
      );

      const res = await handleWhatsAppWebhookEvent(postRequest(STATUS_PAYLOAD, sign(STATUS_PAYLOAD)));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      releaseProcessing();
      await flushBackground();
      expect(whatsappWebhookEventService.processWebhookEvent).toHaveBeenCalledWith(
        "event-1",
        expect.objectContaining({ object: "whatsapp_business_account" })
      );
    });

    it("still answers 200 when processing throws, and marks the event FAILED", async () => {
      vi.mocked(whatsappWebhookEventService.processWebhookEvent).mockRejectedValue(
        new Error("downstream exploded")
      );

      const res = await handleWhatsAppWebhookEvent(postRequest(STATUS_PAYLOAD, sign(STATUS_PAYLOAD)));
      await flushBackground();

      expect(res.status).toBe(200);
      expect(whatsappWebhookEventService.markFailed).toHaveBeenCalledWith(
        "event-1",
        "downstream exploded"
      );
    });

    it("returns 500 when the event cannot even be recorded", async () => {
      vi.mocked(whatsappWebhookEventService.recordReceived).mockRejectedValue(new Error("db down"));

      const res = await handleWhatsAppWebhookEvent(postRequest(STATUS_PAYLOAD, sign(STATUS_PAYLOAD)));

      expect(res.status).toBe(500);
    });

    it("accepts an interactive reply payload", async () => {
      const interactive = JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                field: "messages",
                value: {
                  messages: [
                    {
                      type: "interactive",
                      from: "917901070333",
                      id: "wamid.button",
                      timestamp: "1718000001",
                      interactive: { type: "button_reply", button_reply: { id: "DUES", title: "Dues" } },
                    },
                  ],
                },
              },
            ],
          },
        ],
      });
      vi.mocked(whatsappWebhookEventService.recordReceived).mockResolvedValue({
        event: { id: "event-2", processing_status: "RECEIVED", processing_result: null },
        duplicate: false,
        eventHash: "hash-2",
        payload: JSON.parse(interactive),
      } as any);

      const res = await handleWhatsAppWebhookEvent(postRequest(interactive, sign(interactive)));
      await flushBackground();

      expect(res.status).toBe(200);
      expect(whatsappWebhookEventService.processWebhookEvent).toHaveBeenCalledWith(
        "event-2",
        expect.anything()
      );
    });

    it("acknowledges an event field it has no handler for without failing", async () => {
      const unknownField = JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{ changes: [{ field: "account_update", value: { event: "PARTNER_ADDED" } }] }],
      });
      vi.mocked(whatsappWebhookEventService.recordReceived).mockResolvedValue({
        event: { id: "event-3", processing_status: "RECEIVED", processing_result: null },
        duplicate: false,
        eventHash: "hash-3",
        payload: JSON.parse(unknownField),
      } as any);
      vi.mocked(whatsappWebhookEventService.processWebhookEvent).mockResolvedValue({
        status_events: 0,
        updated_logs: 0,
      } as any);

      const res = await handleWhatsAppWebhookEvent(postRequest(unknownField, sign(unknownField)));

      expect(res.status).toBe(200);
    });
  });

  describe("POST — duplicate deliveries", () => {
    it("acknowledges without reprocessing when the claim is refused", async () => {
      vi.mocked(whatsappWebhookEventService.claimForProcessing).mockResolvedValue(false);

      const res = await handleWhatsAppWebhookEvent(postRequest(STATUS_PAYLOAD, sign(STATUS_PAYLOAD)));
      await flushBackground();

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, duplicate: true });
      expect(whatsappWebhookEventService.processWebhookEvent).not.toHaveBeenCalled();
    });

    it("processes a redelivery exactly once across two concurrent calls", async () => {
      vi.mocked(whatsappWebhookEventService.claimForProcessing)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const [first, second] = await Promise.all([
        handleWhatsAppWebhookEvent(postRequest(STATUS_PAYLOAD, sign(STATUS_PAYLOAD))),
        handleWhatsAppWebhookEvent(postRequest(STATUS_PAYLOAD, sign(STATUS_PAYLOAD))),
      ]);
      await flushBackground();

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(whatsappWebhookEventService.processWebhookEvent).toHaveBeenCalledTimes(1);
    });
  });
});
