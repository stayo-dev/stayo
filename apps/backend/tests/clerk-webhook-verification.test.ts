/**
 * Clerk webhook signature verification (ADR-176).
 *
 * Signature verification is the only thing standing between POST /webhooks/clerk
 * and the open internet — the route is deliberately outside the `/api/:path*`
 * middleware matcher, so there is no session check behind it. These tests sign
 * payloads with the real `svix` library and assert that a genuine delivery is
 * accepted and that every way of faking one is not.
 *
 * PURE — signs and verifies in-process, no database, no network.
 */

import { describe, expect, it } from "vitest";
import { Webhook } from "svix";
import {
  verifyClerkWebhook,
  isHandledEventType,
  HANDLED_EVENT_TYPES,
} from "@/lib/auth/clerk-webhook-verification";

// A syntactically valid Svix signing secret: "whsec_" + base64 key material.
const SECRET = "whsec_" + Buffer.from("clerk-test-signing-key-0123456789").toString("base64");

const EVENT = {
  object: "event",
  type: "user.created",
  data: { id: "user_2abc", email_addresses: [], first_name: "Ada" },
};

function signed(payload: unknown, secret = SECRET, at = new Date()) {
  const body = JSON.stringify(payload);
  const msgId = "msg_" + Math.random().toString(36).slice(2);
  const signature = new Webhook(secret).sign(msgId, at, body);
  return {
    body,
    headers: {
      "svix-id": msgId,
      "svix-timestamp": Math.floor(at.getTime() / 1000).toString(),
      "svix-signature": signature,
    } as Record<string, string>,
  };
}

describe("verifyClerkWebhook", () => {
  it("accepts a genuine Clerk delivery and returns the parsed event", () => {
    const { body, headers } = signed(EVENT);

    const result = verifyClerkWebhook(body, headers, SECRET);

    expect(result.verified).toBe(true);
    if (result.verified) {
      expect(result.event.type).toBe("user.created");
      expect(result.event.data.id).toBe("user_2abc");
    }
  });

  it("reads headers from a real Headers object, not only a plain bag", () => {
    // The route passes `req.headers`. If only the object form worked, every
    // real delivery would fail while every test passed.
    const { body, headers } = signed(EVENT);

    const result = verifyClerkWebhook(body, new Headers(headers), SECRET);

    expect(result.verified).toBe(true);
  });

  it("rejects a body altered after signing", () => {
    const { headers } = signed(EVENT);
    const tampered = JSON.stringify({ ...EVENT, data: { ...EVENT.data, id: "user_attacker" } });

    const result = verifyClerkWebhook(tampered, headers, SECRET);

    expect(result).toMatchObject({ verified: false, reason: "invalid_signature" });
  });

  it("rejects a signature made with a different secret", () => {
    const otherSecret = "whsec_" + Buffer.from("a-completely-different-key-000000").toString("base64");
    const { body, headers } = signed(EVENT, otherSecret);

    const result = verifyClerkWebhook(body, headers, SECRET);

    expect(result).toMatchObject({ verified: false, reason: "invalid_signature" });
  });

  it("rejects a replayed delivery outside the timestamp tolerance", () => {
    // Svix's tolerance is minutes; an hour-old capture must not be replayable.
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const { body, headers } = signed(EVENT, SECRET, anHourAgo);

    const result = verifyClerkWebhook(body, headers, SECRET);

    expect(result).toMatchObject({ verified: false, reason: "invalid_signature" });
  });

  it.each(["svix-id", "svix-timestamp", "svix-signature"])(
    "rejects a delivery missing %s",
    (missing) => {
      const { body, headers } = signed(EVENT);
      delete headers[missing];

      const result = verifyClerkWebhook(body, headers, SECRET);

      expect(result).toMatchObject({ verified: false, reason: "missing_headers" });
    },
  );

  it("distinguishes a missing secret from a bad signature", () => {
    // The route maps these to different status codes — 500 (retry once we are
    // configured) vs 401 (never retry). Collapsing them loses real deliveries.
    const { body, headers } = signed(EVENT);

    const result = verifyClerkWebhook(body, headers, undefined);

    expect(result).toMatchObject({ verified: false, reason: "missing_secret" });
  });

  it("never reports verified on an unsigned request", () => {
    const result = verifyClerkWebhook(JSON.stringify(EVENT), {}, SECRET);
    expect(result.verified).toBe(false);
  });
});

describe("isHandledEventType", () => {
  it("accepts exactly the three user lifecycle events", () => {
    expect([...HANDLED_EVENT_TYPES]).toEqual(["user.created", "user.updated", "user.deleted"]);
    for (const type of HANDLED_EVENT_TYPES) {
      expect(isHandledEventType(type)).toBe(true);
    }
  });

  it("rejects other Clerk events, including neighbouring session ones", () => {
    for (const type of ["session.created", "organization.created", "user.create", ""]) {
      expect(isHandledEventType(type)).toBe(false);
    }
  });
});
