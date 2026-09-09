export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { randomUUID } from "crypto";
import { getLogger } from "@/lib/logger";
import { verifyClerkWebhook, isHandledEventType } from "@/lib/auth/clerk-webhook-verification";
import { syncClerkUser } from "@/src/services/auth/clerk-user-sync-service";

const logger = getLogger("webhook.clerk");

/**
 * Clerk user-lifecycle webhook (ADR-176).
 *
 * POST /webhooks/clerk
 * Production URL: https://api.yourstayo.com/webhooks/clerk
 *
 * ── Why this path is NOT under /api ────────────────────────────────────────
 * `middleware.ts` matches `/api/:path*` only, so a route here is outside the
 * session pipeline by construction rather than by allow-list — there is no
 * `PUBLIC_ROUTES` entry to forget, and no way for a future auth change to start
 * demanding a session from Clerk's servers. The trade-off is that it is not
 * reachable through yourstayo.com, which rewrites only `/api/:path*` to this
 * backend (apps/frontend/vercel.json); Clerk must be pointed at the api.
 * subdomain directly. tests/clerk-webhook-endpoint.test.ts pins both facts.
 *
 * Authentication is the Svix signature over the raw body, verified in
 * lib/auth/clerk-webhook-verification.ts. That is the only thing standing
 * between this endpoint and the internet, so it is checked before the body is
 * parsed, interpreted, or logged.
 *
 * ── Status codes are a retry protocol, not decoration ──────────────────────
 * Svix retries on non-2xx with backoff. So:
 *   200 — processed, or deliberately ignored (unhandled event type, stale
 *         replay, delete of an account we never saw). Nothing to retry.
 *   400 — unparseable/misshapen event. Retrying identical bytes cannot help.
 *   401 — signature missing or invalid. Never retry; this is a rejected caller.
 *   500 — our failure (database down, bug). Retry is exactly right, and the
 *         handlers are idempotent so a replay is safe.
 * Returning 200 on an internal error would silently drop user records.
 */
export async function POST(req: Request) {
  const requestId = req.headers.get("x-request-id") || randomUUID();

  const rawBody = await req.text();

  const result = verifyClerkWebhook(
    rawBody,
    req.headers,
    process.env.CLERK_WEBHOOK_SIGNING_SECRET,
  );

  if (!result.verified) {
    // A missing secret is our misconfiguration, not a hostile caller. It is
    // logged at error level and answered 500 so the delivery is retried after
    // the secret is set, instead of being lost as a 401.
    if (result.reason === "missing_secret") {
      logger.error("clerk.webhook.misconfigured", {
        request_id: requestId,
        detail: result.detail,
      });
      return Response.json({ error: "Webhook not configured" }, { status: 500 });
    }

    logger.warn("clerk.webhook.rejected", {
      request_id: requestId,
      reason: result.reason,
      detail: result.detail,
    });
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = result.event;

  if (!event?.type || !event?.data?.id) {
    logger.warn("clerk.webhook.malformed", { request_id: requestId, type: event?.type });
    return Response.json({ error: "Malformed event" }, { status: 400 });
  }

  if (!isHandledEventType(event.type)) {
    // Clerk sends far more than the three user events; subscribing narrowly in
    // the dashboard is a setting, and settings drift. Acknowledge and drop.
    logger.info("clerk.webhook.unhandled_type", { request_id: requestId, type: event.type });
    return Response.json({ received: true, outcome: "ignored_unhandled_type" }, { status: 200 });
  }

  try {
    const outcome = await syncClerkUser(event);

    logger.info("clerk.webhook.processed", {
      request_id: requestId,
      type: event.type,
      outcome,
    });

    return Response.json({ received: true, outcome }, { status: 200 });
  } catch (error) {
    logger.error("clerk.webhook.failed", {
      request_id: requestId,
      type: event.type,
      // Deliberately not logging the payload: it carries the person's email and
      // name, and webhook logs are retained longer than we need that.
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ error: "Processing failed" }, { status: 500 });
  }
}
