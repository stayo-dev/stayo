export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { whatsappWebhookEventService } from "@/lib/services/notifications/whatsapp-webhook-event-service";
import { getClientIp } from "@/lib/security/api-guard";
import { rateLimitService } from "@/lib/services/rate-limit-service";

const logger = getLogger("webhook.whatsapp");

/**
 * Meta WhatsApp Cloud API webhook.
 *
 * GET verifies the webhook subscription challenge.
 * POST records signed delivery lifecycle callbacks and projects status changes
 * onto whatsapp_logs. This endpoint is public because Meta calls it server-side.
 */
export async function GET(req: NextRequest) {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (!verifyToken) {
    logger.error("webhook.whatsapp.verify_misconfigured", {
      reason: "WHATSAPP_VERIFY_TOKEN not configured",
    });
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (mode === "subscribe" && token === verifyToken && challenge) {
    logger.info("webhook.whatsapp.verify_success");
    return new Response(challenge, { status: 200 });
  }

  logger.warn("webhook.whatsapp.verify_failed", {
    mode: mode || null,
    has_challenge: Boolean(challenge),
  });
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const requestIp = getClientIp(req) || "unknown";
  let webhookEventId: string | null = null;

  try {
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const rawBody = await req.text();
    const signatureHeader = req.headers.get("x-hub-signature-256");
    const signatureResult = verifyMetaSignature(rawBody, signatureHeader);

    const eventRecord = await whatsappWebhookEventService.recordReceived({
      rawBody,
      headers,
      signatureVerified: signatureResult.verified,
      signatureAlgorithm: "HMAC_SHA256",
      signatureFailureReason: signatureResult.failureReason,
    });
    webhookEventId = eventRecord.event.id;

    if (!signatureResult.verified) {
      const abuseLimit = await rateLimitService.checkStatelessLimit({
        scope: "webhook:whatsapp:signature-failed",
        identifier: requestIp,
        maxAttempts: 30,
        windowSeconds: 10 * 60,
      });
      logger.warn("webhook.whatsapp.signature_invalid", {
        request_id: requestId,
        webhook_event_id: webhookEventId,
        reason: signatureResult.failureReason,
        ip: requestIp,
        rate_limited: !abuseLimit.allowed,
      });
      await whatsappWebhookEventService.markFailed(
        webhookEventId,
        signatureResult.failureReason || "signature verification failed",
        "FAILED"
      );
      return new Response(abuseLimit.allowed ? "Unauthorized" : "Too Many Requests", {
        status: abuseLimit.allowed ? 401 : 429,
      });
    }

    if (eventRecord.duplicate && eventRecord.event.processing_status === "PROCESSED") {
      logger.info("webhook.whatsapp.duplicate_processed", {
        request_id: requestId,
        webhook_event_id: webhookEventId,
      });
      return NextResponse.json({ success: true, duplicate: true }, { status: 200 });
    }

    const result = await whatsappWebhookEventService.processWebhookEvent(
      webhookEventId,
      eventRecord.payload
    );

    logger.metrics("webhook.whatsapp.processed", {
      request_id: requestId,
      webhook_event_id: webhookEventId,
      duration_ms: Date.now() - startTime,
      status_events: result.status_events,
      updated_logs: result.updated_logs,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    logger.error("webhook.whatsapp.processing_failed", {
      request_id: requestId,
      webhook_event_id: webhookEventId,
      duration_ms: Date.now() - startTime,
      error: error?.message || String(error),
    });

    if (webhookEventId) {
      await whatsappWebhookEventService
        .markFailed(webhookEventId, error?.message || String(error))
        .catch(() => {});
    }

    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}

function verifyMetaSignature(rawBody: string, signatureHeader: string | null) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    return {
      verified: false,
      failureReason: "WHATSAPP_APP_SECRET not configured",
    };
  }

  if (!signatureHeader) {
    return {
      verified: false,
      failureReason: "missing x-hub-signature-256 header",
    };
  }

  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) {
    return {
      verified: false,
      failureReason: "unsupported signature scheme",
    };
  }

  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  const received = signatureHeader.slice(prefix.length);

  if (!/^[a-f0-9]{64}$/i.test(received)) {
    return {
      verified: false,
      failureReason: "malformed signature",
    };
  }

  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");
  const verified =
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer);

  return {
    verified,
    failureReason: verified ? null : "signature mismatch",
  };
}
