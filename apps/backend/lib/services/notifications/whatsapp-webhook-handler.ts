import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getLogger } from "@/lib/logger";
import { getClientIp } from "@/lib/security/api-guard";
import { rateLimitService } from "@/lib/services/rate-limit-service";
import { whatsappWebhookEventService } from "./whatsapp-webhook-event-service";

const logger = getLogger("webhook.whatsapp");

/**
 * Meta WhatsApp Cloud API webhook, shared by both mounted routes:
 *
 *   /api/webhooks/whatsapp                — canonical (production URL)
 *   /api/webhooks/notifications/whatsapp  — legacy alias, kept so an existing
 *                                           Meta app subscription keeps working
 *
 * Both routes delegate here; there is exactly one implementation.
 */

/**
 * Dashboard-pasted secrets routinely arrive wrapped in quotes or with a
 * trailing newline; neither is part of the value the operator intended.
 */
function normalizeSecret(value: string) {
  return value.trim().replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
}

/** Short, non-reversible identifier — safe to put in logs, enough to compare two values. */
function fingerprint(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex").slice(0, 10);
}

function resolveFromEnv(names: string[]): { value: string; source: string } | null {
  for (const name of names) {
    const normalized = normalizeSecret(process.env[name] || "");
    if (normalized) return { value: normalized, source: name };
  }
  return null;
}

/** Meta's callback verification token, configured in the app's webhook settings. */
export function resolveVerifyTokenConfig() {
  return resolveFromEnv(["WHATSAPP_WEBHOOK_VERIFY_TOKEN", "WHATSAPP_VERIFY_TOKEN"]);
}

export function resolveVerifyToken(): string | null {
  return resolveVerifyTokenConfig()?.value ?? null;
}

/** The Meta app secret used to sign every webhook body (X-Hub-Signature-256). */
export function resolveAppSecretConfig() {
  return resolveFromEnv(["META_APP_SECRET", "WHATSAPP_APP_SECRET"]);
}

export function resolveAppSecret(): string | null {
  return resolveAppSecretConfig()?.value ?? null;
}

function timingSafeStringEqual(a: string, b: string) {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function verifyMetaSignature(rawBody: string, signatureHeader: string | null) {
  const appSecret = resolveAppSecret();
  if (!appSecret) {
    return {
      verified: false,
      failureReason: "neither META_APP_SECRET nor WHATSAPP_APP_SECRET is set",
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

/**
 * Keep post-response work alive on hosts that freeze the process once the
 * response is flushed (Vercel). On a long-lived Node server (Render) there is
 * nothing to register with and the promise simply runs to completion.
 */
function keepAlive(promise: Promise<unknown>) {
  try {
    const ctx = (globalThis as any)[Symbol.for("@vercel/request-context")]?.get?.();
    if (typeof ctx?.waitUntil === "function") {
      ctx.waitUntil(promise);
      return;
    }
  } catch {
    // fall through to plain fire-and-forget
  }
  void promise;
}

/**
 * GET — Meta's subscription challenge.
 * Echoes `hub.challenge` verbatim with 200 when `hub.verify_token` matches;
 * 403 otherwise.
 */
export async function handleWhatsAppWebhookVerification(req: NextRequest) {
  const configured = resolveVerifyTokenConfig();
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const rawToken = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  const token = rawToken === null ? null : normalizeSecret(rawToken);

  if (!configured) {
    logger.error("webhook.whatsapp.verify_misconfigured", {
      reason: "neither WHATSAPP_WEBHOOK_VERIFY_TOKEN nor WHATSAPP_VERIFY_TOKEN is set",
    });
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (mode === "subscribe" && token && challenge && timingSafeStringEqual(token, configured.value)) {
    logger.info("webhook.whatsapp.verify_success", { token_source: configured.source });
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // Enough to diagnose a 403 without putting the shared secret in a log:
  // equal fingerprints mean equal tokens, and the length/trim fields catch the
  // usual culprits (stray whitespace, quotes, a truncated paste). A plain GET
  // with no hub.* params lands here too — that is the expected answer to a
  // browser visit, not a fault.
  const reason = !token
    ? "missing hub.verify_token"
    : mode !== "subscribe"
      ? `hub.mode is ${JSON.stringify(mode)}, expected "subscribe"`
      : !challenge
        ? "missing hub.challenge"
        : "token mismatch";

  logger.warn("webhook.whatsapp.verify_failed", {
    reason,
    mode: mode || null,
    has_challenge: Boolean(challenge),
    token_source: configured.source,
    received_token_fingerprint: token ? fingerprint(token) : null,
    received_token_length: token?.length ?? 0,
    received_token_was_padded: rawToken !== null && rawToken !== token,
    expected_token_fingerprint: fingerprint(configured.value),
    expected_token_length: configured.value.length,
  });
  return new Response("Forbidden", { status: 403 });
}

/**
 * POST — every subscribed Meta event (messages, statuses, interactive replies,
 * and any other field we do not act on yet).
 *
 * The request is persisted and acknowledged with 200 as soon as the signature
 * checks out; business logic runs after the response so a slow handler can
 * never push Meta into its retry path. Duplicate deliveries are recognised by
 * a hash of the raw body and are never processed twice concurrently.
 */
export async function handleWhatsAppWebhookEvent(req: NextRequest) {
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

    // Atomic claim: exactly one delivery of a given body gets to run the
    // handlers. A Meta retry that lands while the first is still in flight is
    // acknowledged and dropped, so no tenant gets two replies.
    const claimed = await whatsappWebhookEventService.claimForProcessing(webhookEventId);
    if (!claimed) {
      logger.info("webhook.whatsapp.duplicate_ignored", {
        request_id: requestId,
        webhook_event_id: webhookEventId,
        processing_status: eventRecord.event.processing_status,
      });
      return NextResponse.json({ success: true, duplicate: true }, { status: 200 });
    }

    const eventId = webhookEventId;
    keepAlive(
      whatsappWebhookEventService
        .processWebhookEvent(eventId, eventRecord.payload)
        .then((result: any) => {
          logger.metrics("webhook.whatsapp.processed", {
            request_id: requestId,
            webhook_event_id: eventId,
            duration_ms: Date.now() - startTime,
            status_events: result?.status_events ?? 0,
            updated_logs: result?.updated_logs ?? 0,
            processed_commands: result?.processed_commands ?? 0,
          });
        })
        .catch(async (error: any) => {
          logger.error("webhook.whatsapp.processing_failed", {
            request_id: requestId,
            webhook_event_id: eventId,
            duration_ms: Date.now() - startTime,
            error: error?.message || String(error),
          });
          // Leaving the row FAILED lets Meta's retry (or a manual replay)
          // claim it again — claimForProcessing accepts RECEIVED and FAILED.
          await whatsappWebhookEventService
            .markFailed(eventId, error?.message || String(error))
            .catch(() => {});
        })
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    logger.error("webhook.whatsapp.receive_failed", {
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

    // 500 here (not 200) is deliberate: the event was never durably recorded,
    // so Meta's retry is the only thing that can recover it.
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
