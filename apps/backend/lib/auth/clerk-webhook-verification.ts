/**
 * Clerk webhook signature verification (ADR-176).
 *
 * Clerk signs webhooks with Svix: an HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${body}`
 * keyed by the base64 part of the `whsec_...` signing secret, presented as a
 * space-separated list of `v1,<sig>` entries so a secret can be rotated without
 * dropping deliveries.
 *
 * We delegate to the `svix` library rather than hand-rolling that, unlike the
 * Razorpay webhook next door which is a single fixed HMAC. Svix verification has
 * three parts that are each easy to get subtly wrong — the signed payload is the
 * id and timestamp *joined to* the body (not the body alone), the comparison must
 * be constant-time across a multi-signature list, and the timestamp must be
 * rejected outside a tolerance window or a captured delivery can be replayed
 * forever. `svix` is Clerk's own recommendation and already handles all three.
 *
 * The verification MUST run against the raw request body. `JSON.parse` followed by
 * `JSON.stringify` does not round-trip byte-for-byte (key order, unicode escapes,
 * number formatting), and any drift invalidates the HMAC.
 *
 * PURE MODULE — no I/O, no database, runs under vitest.pure.config.ts.
 */

import { Webhook } from "svix";

/** The Svix headers Clerk sends on every delivery. */
export const SVIX_HEADERS = ["svix-id", "svix-timestamp", "svix-signature"] as const;

export type ClerkVerificationFailure =
  | "missing_secret"
  | "missing_headers"
  | "invalid_signature";

export type ClerkVerificationResult =
  | { verified: true; event: ClerkWebhookEvent }
  | { verified: false; reason: ClerkVerificationFailure; detail: string };

/** The three user events this endpoint handles. Anything else is acknowledged and ignored. */
export const HANDLED_EVENT_TYPES = ["user.created", "user.updated", "user.deleted"] as const;
export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number];

export interface ClerkEmailAddress {
  id: string;
  email_address: string;
}

/**
 * The Clerk user object, narrowed to what we consume. `user.deleted` delivers a
 * deliberately minimal shape — `{ id, deleted: true, object: "user" }` — with no
 * email or name, which is why every field but `id` is optional here.
 */
export interface ClerkUserData {
  id: string;
  email_addresses?: ClerkEmailAddress[];
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string | null;
  /** Clerk stamps these as epoch milliseconds, not ISO strings. */
  updated_at?: number | null;
  created_at?: number | null;
  deleted?: boolean;
}

export interface ClerkWebhookEvent {
  type: string;
  object: string;
  data: ClerkUserData;
}

export function isHandledEventType(type: string): type is HandledEventType {
  return (HANDLED_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * Verify a Clerk delivery and return the parsed event.
 *
 * Returns a result rather than throwing so the route can distinguish a
 * misconfigured server (`missing_secret` — our fault, retry is pointless) from a
 * rejected caller (`invalid_signature` — never retry), and log each accordingly.
 *
 * @param rawBody the exact bytes of the request body, unparsed
 * @param headers the request headers, read case-insensitively
 * @param secret  the Clerk signing secret (`whsec_...`)
 */
export function verifyClerkWebhook(
  rawBody: string,
  headers: Headers | Record<string, string | undefined>,
  secret: string | undefined,
): ClerkVerificationResult {
  if (!secret) {
    return {
      verified: false,
      reason: "missing_secret",
      detail: "CLERK_WEBHOOK_SIGNING_SECRET is not set",
    };
  }

  const get = (name: string): string | undefined => {
    if (typeof (headers as Headers).get === "function") {
      return (headers as Headers).get(name) ?? undefined;
    }
    const bag = headers as Record<string, string | undefined>;
    // Header names are case-insensitive; Node lowercases them but a plain object
    // built by hand may not have.
    return bag[name] ?? bag[name.toLowerCase()] ?? bag[name.toUpperCase()];
  };

  const svixHeaders: Record<string, string> = {};
  for (const name of SVIX_HEADERS) {
    const value = get(name);
    if (!value) {
      return {
        verified: false,
        reason: "missing_headers",
        detail: `missing ${name}`,
      };
    }
    svixHeaders[name] = value;
  }

  try {
    const event = new Webhook(secret).verify(rawBody, svixHeaders) as ClerkWebhookEvent;
    return { verified: true, event };
  } catch (error) {
    return {
      verified: false,
      reason: "invalid_signature",
      detail: error instanceof Error ? error.message : "verification failed",
    };
  }
}
