import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { incrementOtpDeliveryStatus } from "@/lib/metrics";
import { rateLimitService } from "@/lib/services/rate-limit-service";
import { MetaWhatsAppProvider, maskWhatsAppPhone } from "./providers/whatsapp/meta-provider";
import { ownerWhatsAppAssistantService } from "./owner-whatsapp-assistant";
import { routeInboundMessage } from "./routing/message-router";
import { resolveSenderIdentity } from "./routing/identity-resolver";
import { INTENTS, defaultIntentResolver } from "./routing/intent-resolvers";
import {
  ANY_ROLE,
  Intent,
  IntentDefinition,
  PERMISSIONS,
  SenderIdentity,
} from "./routing/types";
import { commandCenterService } from "./command-center/service";
import { unknownSenderMessage } from "./command-center/menu";

const logger = getLogger("whatsapp.webhook-event");

type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: unknown;
        statuses?: MetaWebhookStatus[];
      };
    }>;
  }>;
};

type MetaWebhookStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{
    code?: number | string;
    title?: string;
    message?: string;
    details?: string;
  }>;
};

type WhatsAppLifecycleStatus = "SENT" | "DELIVERED" | "READ" | "FAILED";

type ExtractedStatusEvent = {
  eventType: string;
  providerMessageId: string;
  status: WhatsAppLifecycleStatus;
  providerTimestamp?: string;
  recipientId?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  rawStatus: MetaWebhookStatus;
};

type RecordReceivedInput = {
  rawBody: string;
  headers: Record<string, string>;
  signatureVerified: boolean;
  signatureAlgorithm?: string | null;
  signatureFailureReason?: string | null;
};

type RecordReceivedResult = {
  event: {
    id: string;
    processing_status: string;
    processing_result: unknown;
  };
  duplicate: boolean;
  eventHash: string;
  payload: unknown;
};

const PROVIDER = "META";
const STATUS_RANK: Record<string, number> = {
  UNKNOWN: 0,
  RESERVED: 0,
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
  FAILED_RETRYABLE: 4,
  FAILED_FINAL: 4,
};

export function computeWhatsAppWebhookEventHash(rawBody: string) {
  return crypto
    .createHash("sha256")
    .update(`${PROVIDER}:${rawBody}`)
    .digest("hex");
}

export function redactWhatsAppWebhookHeaders(headers: Record<string, string>) {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase();
    if (["authorization", "cookie", "set-cookie", "x-hub-signature-256"].includes(lower)) {
      redacted[key] = value ? "[REDACTED]" : "";
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    return { raw: rawBody };
  }
}

function normalizeStatus(status?: string): WhatsAppLifecycleStatus | null {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "sent") return "SENT";
  if (normalized === "delivered") return "DELIVERED";
  if (normalized === "read") return "READ";
  if (normalized === "failed") return "FAILED";
  return null;
}

function firstStatusEvent(payload: unknown) {
  return extractStatusEvents(payload)[0] || null;
}

function extractStatusEvents(payload: unknown): ExtractedStatusEvent[] {
  const webhook = payload as MetaWebhookPayload;
  const events: ExtractedStatusEvent[] = [];

  for (const entry of webhook.entry || []) {
    for (const change of entry.changes || []) {
      const statuses = change.value?.statuses || [];
      for (const item of statuses) {
        const lifecycleStatus = normalizeStatus(item.status);
        if (!lifecycleStatus || !item.id) continue;

        const error = item.errors?.[0];
        events.push({
          eventType: change.field || "messages",
          providerMessageId: item.id,
          status: lifecycleStatus,
          providerTimestamp: item.timestamp,
          recipientId: item.recipient_id,
          errorCode: error?.code ? String(error.code) : null,
          errorMessage: error?.message || error?.title || error?.details || null,
          rawStatus: item,
        });
      }
    }
  }

  return events;
}

type ExtractedMessageEvent = {
  from: string;
  messageId: string;
  timestamp: string;
  body: string;
  messageType: "text" | "interactive";
  interactiveType?: "button_reply" | "list_reply";
};

export function extractMessageEvents(payload: unknown): ExtractedMessageEvent[] {
  const webhook = payload as any;
  const events: ExtractedMessageEvent[] = [];

  for (const entry of webhook.entry || []) {
    for (const change of entry.changes || []) {
      const messages = change.value?.messages || [];
      for (const item of messages) {
        if (item.type === "text" && item.text?.body) {
          events.push({
            from: item.from,
            messageId: item.id,
            timestamp: item.timestamp,
            body: item.text.body,
            messageType: "text",
          });
          continue;
        }

        if (item.type === "interactive" && item.interactive?.button_reply?.id) {
          events.push({
            from: item.from,
            messageId: item.id,
            timestamp: item.timestamp,
            body: item.interactive.button_reply.id,
            messageType: "interactive",
            interactiveType: "button_reply",
          });
          continue;
        }

        if (item.type === "interactive" && item.interactive?.list_reply?.id) {
          events.push({
            from: item.from,
            messageId: item.id,
            timestamp: item.timestamp,
            body: item.interactive.list_reply.id,
            messageType: "interactive",
            interactiveType: "list_reply",
          });
          continue;
        }

        // A quick-reply button on an approved *template* — not the same shape
        // as an interactive reply: Meta delivers `type: "button"` with a
        // `button.payload` we chose at template-creation time.
        //
        // This arrives as **text**, deliberately. A template quick reply is the
        // reader saying that word ("Help"), and its payload is a plain keyword
        // rather than one of our `CC:` ids — so it must resolve through the
        // ordinary command vocabulary, not through `decodePayload`.
        //
        // Until `stayo_guardian_whatsapp_activated` shipped its [Help] button,
        // this type was in `findUnhandledMessageTypes`' deliberately-dropped
        // list. A guardian's very first interaction is that tap; dropping it
        // would have answered the product's most important introduction with
        // silence.
        if (item.type === "button" && (item.button?.payload || item.button?.text)) {
          events.push({
            from: item.from,
            messageId: item.id,
            timestamp: item.timestamp,
            body: String(item.button.payload || item.button.text),
            messageType: "text",
          });
        }
      }
    }
  }

  return events;
}

/**
 * Message types the extractor above deliberately does not handle (media,
 * stickers, reactions, location, system…). Template quick-reply `button` used
 * to be on this list and is now handled — see the note in the extractor.
 * Returned so the caller can say so out loud — a payload that arrives, matches
 * nothing, and is marked PROCESSED with zero events is otherwise invisible.
 */
export function findUnhandledMessageTypes(payload: unknown, extracted: ExtractedMessageEvent[]) {
  const handledIds = new Set(extracted.map((event) => event.messageId));
  const unhandled: Array<{ id: string; type: string }> = [];

  for (const entry of (payload as any)?.entry || []) {
    for (const change of entry.changes || []) {
      for (const item of change.value?.messages || []) {
        if (!handledIds.has(item.id)) {
          unhandled.push({ id: item.id, type: item.type || "unknown" });
        }
      }
    }
  }

  return unhandled;
}

// Command matching lives with the command center's own vocabulary. The old
// `resolveCommandKey` / `buildHelpText` exports are gone with the five resident
// commands they served — see `command-center/commands.ts`.

export class WhatsAppWebhookEventService {
  async recordReceived(input: RecordReceivedInput): Promise<RecordReceivedResult> {
    const eventHash = computeWhatsAppWebhookEventHash(input.rawBody);
    const payload = parseJson(input.rawBody);
    const firstStatus = firstStatusEvent(payload);
    const eventType = firstStatus?.eventType || inferEventType(payload);
    const providerMessageId = firstStatus?.providerMessageId || null;

    const existing = await prisma.$queryRaw<Array<{
      id: string;
      processing_status: string;
      processing_result: unknown;
    }>>`
      SELECT id::text, processing_status, processing_result
      FROM whatsapp_webhook_events
      WHERE event_hash = ${eventHash}
      LIMIT 1
    `;

    if (existing[0]) {
      return { event: existing[0], duplicate: true, eventHash, payload };
    }

    const webhookEventId = crypto.randomUUID();

    // ON CONFLICT DO NOTHING, not a bare INSERT: two Meta deliveries of the
    // same body can race past the SELECT above, and a unique-violation here
    // would turn a duplicate into a 500 (and another Meta retry).
    const inserted = await prisma.$queryRaw<Array<{
      id: string;
      processing_status: string;
      processing_result: unknown;
    }>>`
      INSERT INTO whatsapp_webhook_events (
        id,
        provider,
        event_hash,
        event_type,
        provider_message_id,
        raw_payload,
        headers_redacted,
        signature_verified,
        signature_algorithm,
        signature_failure_reason,
        processing_status
      )
      VALUES (
        ${webhookEventId}::uuid,
        ${PROVIDER},
        ${eventHash},
        ${eventType},
        ${providerMessageId},
        ${JSON.stringify(payload)}::jsonb,
        ${JSON.stringify(redactWhatsAppWebhookHeaders(input.headers))}::jsonb,
        ${input.signatureVerified},
        ${input.signatureAlgorithm || null},
        ${input.signatureFailureReason || null},
        'RECEIVED'
      )
      ON CONFLICT (event_hash) DO NOTHING
      RETURNING id::text, processing_status, processing_result
    `;

    if (!inserted[0]) {
      const raced = await prisma.$queryRaw<Array<{
        id: string;
        processing_status: string;
        processing_result: unknown;
      }>>`
        SELECT id::text, processing_status, processing_result
        FROM whatsapp_webhook_events
        WHERE event_hash = ${eventHash}
        LIMIT 1
      `;
      return { event: raced[0], duplicate: true, eventHash, payload };
    }

    return { event: inserted[0], duplicate: false, eventHash, payload };
  }

  /**
   * Take exclusive ownership of an event before running its handlers.
   *
   * Returns false when another delivery already holds it — that is the guard
   * against a Meta retry re-running command handlers (and re-sending replies)
   * while the first delivery is still in flight. A row left PROCESSING by a
   * crashed process becomes claimable again after 10 minutes; FAILED rows are
   * immediately claimable so a retry can recover them.
   */
  async claimForProcessing(eventId: string): Promise<boolean> {
    const claimed = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE whatsapp_webhook_events
      SET processing_status = 'PROCESSING'
      WHERE id = ${eventId}::uuid
        AND (
          processing_status IN ('RECEIVED', 'FAILED')
          OR (processing_status = 'PROCESSING' AND received_at < now() - interval '10 minutes')
        )
      RETURNING id::text
    `;
    return claimed.length > 0;
  }

  async processWebhookEvent(eventId: string, payload: unknown) {
    await this.markProcessing(eventId);

    // 1. Check for inbound messages (commands)
    const messages = extractMessageEvents(payload);

    const unhandled = findUnhandledMessageTypes(payload, messages);
    if (unhandled.length > 0) {
      logger.warn("whatsapp.webhook.unhandled_message_types", {
        webhook_event_id: eventId,
        count: unhandled.length,
        types: unhandled.map((item) => item.type),
        message_ids: unhandled.map((item) => item.id),
      });
    }

    if (messages.length > 0) {
      let processedCommands = 0;
      let fallbackReplies = 0;
      let deniedMessages = 0;
      let failedMessages = 0;
      const commandResults: any[] = [];

      for (const msg of messages) {
        logger.info("whatsapp.webhook.inbound_message", {
          webhook_event_id: eventId,
          from: msg.from,
          message_id: msg.messageId,
          message_type: msg.messageType,
          interactive_type: msg.interactiveType || null,
          body_preview: msg.body.slice(0, 80),
        });

        // One bad message must not abandon the rest of the batch, and must not
        // leave the sender staring at silence.
        try {
          const outcome = await routeInboundMessage(msg, {
            resolveIdentity: resolveSenderIdentity,
            intentResolver: defaultIntentResolver,
            registry: this.buildIntentRegistry(),
            onFallback: ({ message }) => this.sendUnrecognizedFallback(eventId, message),
            onDenied: ({ message, identity, intent }) =>
              this.sendPermissionDenied(eventId, message, identity, intent),
            onError: ({ message }) => this.sendErrorNotice(message),
            correlationId: eventId,
          });

          commandResults.push({
            phone: msg.from,
            role: outcome.identity.role,
            intent: outcome.intent?.name || null,
            status: outcome.status,
            result: outcome.result,
          });

          if (outcome.status === "HANDLED") processedCommands++;
          else if (outcome.status === "FALLBACK") fallbackReplies++;
          else if (outcome.status === "DENIED") deniedMessages++;
          else failedMessages++;
        } catch (error: any) {
          failedMessages++;
          logger.error("whatsapp.webhook.message_failed", {
            webhook_event_id: eventId,
            from: msg.from,
            message_id: msg.messageId,
            body_preview: msg.body.slice(0, 80),
            error: error?.message || String(error),
          });
          commandResults.push({
            phone: msg.from,
            success: false,
            reason: "HANDLER_ERROR",
            error: error?.message || String(error),
          });
          await this.sendErrorNotice(msg).catch(() => {});
        }
      }

      if (processedCommands > 0 || fallbackReplies > 0 || deniedMessages > 0 || failedMessages > 0) {
        const result = {
          inbound_messages: messages.length,
          processed_commands: processedCommands,
          fallback_replies: fallbackReplies,
          denied_messages: deniedMessages,
          failed_messages: failedMessages,
          command_results: commandResults,
        };
        await this.markProcessed(eventId, result);
        return result;
      }
    }

    // 2. Fallback to status events processing
    const statuses = extractStatusEvents(payload);
    if (statuses.length === 0) {
      const result = { status_events: 0, updated_logs: 0 };
      await this.markProcessed(eventId, result);
      return result;
    }

    let updatedLogs = 0;
    for (const statusEvent of statuses) {
      updatedLogs += await this.applyStatusEvent(statusEvent);
      await this.applyOtpStatusEvent(statusEvent);
    }

    const result = {
      status_events: statuses.length,
      updated_logs: updatedLogs,
      provider_message_ids: statuses.map((event) => event.providerMessageId),
    };
    await this.markProcessed(eventId, result);

    logger.info("whatsapp.webhook.processed", {
      webhook_event_id: eventId,
      status_events: statuses.length,
      updated_logs: updatedLogs,
    });

    return result;
  }

  async markFailed(eventId: string, error: string, status = "FAILED") {
    await prisma.$executeRaw`
      UPDATE whatsapp_webhook_events
      SET processing_status = ${status},
          error_message = ${error.slice(0, 500)},
          processed_at = now()
      WHERE id = ${eventId}::uuid
    `;
  }

  private async markProcessing(eventId: string) {
    await prisma.$executeRaw`
      UPDATE whatsapp_webhook_events
      SET processing_status = 'PROCESSING'
      WHERE id = ${eventId}::uuid
    `;
  }

  private async markProcessed(eventId: string, result: unknown) {
    await prisma.$executeRaw`
      UPDATE whatsapp_webhook_events
      SET processing_status = 'PROCESSED',
          processing_result = ${JSON.stringify(result)}::jsonb,
          processed_at = now()
      WHERE id = ${eventId}::uuid
    `;
  }

  private async applyStatusEvent(event: ExtractedStatusEvent) {
    const incomingRank = STATUS_RANK[event.status];
    const providerResponse = JSON.stringify({
      webhook_status: event.rawStatus,
      provider_timestamp: event.providerTimestamp || null,
      recipient_id: event.recipientId || null,
    });

    const count = await prisma.$executeRaw`
      UPDATE whatsapp_logs
      SET status = ${event.status},
          delivery_status = ${event.status},
          provider_error_code = ${event.status === "FAILED" ? event.errorCode : null},
          provider_error_message = ${event.status === "FAILED" ? event.errorMessage : null},
          provider_response = COALESCE(provider_response, '{}'::jsonb) || ${providerResponse}::jsonb
      WHERE provider_message_id = ${event.providerMessageId}
        AND (
          delivery_status = 'PENDING'
          OR (delivery_status = 'SENT' AND ${event.status} IN ('SENT', 'DELIVERED', 'READ', 'FAILED'))
          OR (delivery_status = 'DELIVERED' AND ${event.status} = 'READ')
        )
    `;

    if (count === 0) {
      logger.warn("whatsapp.webhook.unmatched_or_stale_status", {
        provider_message_id: event.providerMessageId,
        status: event.status,
      });
    }

    return Number(count || 0);
  }

  private async applyOtpStatusEvent(event: ExtractedStatusEvent) {
    incrementOtpDeliveryStatus(event.status);

    const count = await prisma.$executeRaw`
      UPDATE phone_verification_otps
      SET provider_status = ${event.status},
          failure_reason = ${event.status === "FAILED" ? event.errorMessage : null}
      WHERE meta_message_id = ${event.providerMessageId}
    `;

    if (Number(count || 0) === 0) return;

    logger.info("whatsapp.webhook.otp_status_updated", {
      provider_message_id: event.providerMessageId,
      status: event.status,
      updated_otps: Number(count || 0),
    });

    // Re-read so the delivery events carry the same correlation id (the OTP
    // record id) as otp.generated / otp.send.* / otp.verified. Meta's callback
    // only knows its own message id, so this is the join.
    const rows = await prisma.$queryRaw<Array<{ id: string; phone: string; purpose: string }>>`
      SELECT id::text, phone, purpose
      FROM phone_verification_otps
      WHERE meta_message_id = ${event.providerMessageId}
      LIMIT 1
    `;
    const otp = rows[0];
    if (!otp) return;

    const lifecycleEvent =
      event.status === "DELIVERED" ? "otp.delivered" : event.status === "READ" ? "otp.read" : null;

    if (lifecycleEvent) {
      logger.info(lifecycleEvent, {
        correlation_id: otp.id,
        phone: maskWhatsAppPhone(otp.phone),
        purpose: otp.purpose,
        provider_message_id: event.providerMessageId,
        provider_timestamp: event.providerTimestamp || null,
      });
      return;
    }

    if (event.status === "FAILED") {
      logger.error("otp.send.failed", {
        correlation_id: otp.id,
        phone: maskWhatsAppPhone(otp.phone),
        purpose: otp.purpose,
        provider_message_id: event.providerMessageId,
        source: "webhook",
        error_code: event.errorCode || null,
        error: event.errorMessage || null,
      });
    }
  }

  /**
   * A tapped button or list row.
   *
   * `CC:*` payloads carry both the command and the resident it concerns, which
   * is what let the invisible 30-minute "active resident" mode be deleted
   * outright. Anything else is offered to the owner assistant, which owns its
   * own payload vocabulary.
   */
  private async handleInteractiveReply(
    msg: ExtractedMessageEvent,
    identity: SenderIdentity
  ): Promise<any | null> {
    const result = await commandCenterService.handleInteractive(msg.from, msg.body.trim(), identity);
    return result.handled ? result : null;
  }

  /**
   * The intent table: what each intent is for, and who may invoke it.
   *
   * This is the only place authorization is expressed. Adding a role means
   * adding it to `allowedRoles` here; adding an LLM-resolved intent means
   * adding a row. Neither touches the router.
   *
   * The five separate resident intents that used to live here — BALANCE, DUES,
   * PAY, STATUS and SWITCH — are one row now. They were never five questions:
   * four of them read the same obligations and printed different shapes of the
   * same answer, and SWITCH existed only to escape a mode that no longer
   * exists. See `command-center/commands.ts` for what replaced them.
   */
  private buildIntentRegistry(): Record<string, IntentDefinition> {
    return {
      [INTENTS.COMMAND_CENTER]: {
        name: INTENTS.COMMAND_CENTER,
        description:
          "Resident and guardian self-service: what rent is due, a payment link for it, " +
          "instalment progress, the last receipt, and the menu.",
        // GUARDIAN is a first-class role here, not a tenant with a caveat. The
        // permission it lacks (RESIDENT_SWITCH) is one nobody needs any more.
        allowedRoles: ["TENANT", "GUARDIAN", "OWNER", "ADMIN", "STAFF"],
        requiredPermissions: [PERMISSIONS.BILLING_READ],
        handler: ({ message, identity }) =>
          commandCenterService.handleText(message.from, message.body, identity),
      },
      [INTENTS.GUARDIAN_VERIFICATION]: {
        name: INTENTS.GUARDIAN_VERIFICATION,
        description: "A six-digit code answering a guardian verification challenge.",
        // Deliberately open on roles: the sender is a guardian by phone match,
        // and the code itself is the authorization. `handleText` still refuses
        // any number we are not actually challenging.
        allowedRoles: ANY_ROLE,
        handler: ({ message, identity }) =>
          commandCenterService.handleText(message.from, message.body, identity),
      },
      [INTENTS.INTERACTIVE_REPLY]: {
        name: INTENTS.INTERACTIVE_REPLY,
        description: "Handle a tapped button or list selection.",
        // The payload was minted by a message we sent to this number, so the
        // authorization already happened when we sent it. `dispatch` still
        // re-checks that the resident named in the payload is one of theirs.
        allowedRoles: ANY_ROLE,
        handler: ({ message, identity }) => this.handleInteractiveReply(message, identity),
      },
      [INTENTS.OWNER_ASSISTANT]: {
        name: INTENTS.OWNER_ASSISTANT,
        description:
          "Owner-side assistant: briefings, collections, invites, interactive menus, and LINK.",
        // Deliberately open: LINK must work from a number we do not yet know —
        // that is how an owner links their phone. The assistant authorizes each
        // command itself and returns `handled: false` when it declines, which
        // sends the router on to the next candidate instead of ending here.
        allowedRoles: ANY_ROLE,
        handler: ({ message }) =>
          ownerWhatsAppAssistantService.processInboundMessage(message.from, message.body),
      },
    };
  }

  /** Understood the request, but this sender may not make it. Say so plainly. */
  private async sendPermissionDenied(
    eventId: string,
    msg: ExtractedMessageEvent,
    identity: SenderIdentity,
    intent: Intent
  ) {
    logger.info("whatsapp.webhook.permission_denied", {
      webhook_event_id: eventId,
      from: msg.from,
      role: identity.role,
      intent: intent.name,
      body_preview: msg.body.slice(0, 80),
    });

    const limit = await rateLimitService.checkStatelessLimit({
      scope: "whatsapp_denied",
      identifier: msg.from,
      maxAttempts: 3,
      windowSeconds: 10 * 60,
    });
    if (!limit.allowed) {
      return { phone: msg.from, channel: "DENIED", success: false, reason: "RATE_LIMITED" };
    }

    const provider = new MetaWhatsAppProvider();
    await provider.sendTextMessage(
      msg.from,
      unknownSenderMessage()
    );

    return { phone: msg.from, channel: "DENIED", success: true, intent: intent.name };
  }

  /**
   * Nothing matched — answer anyway. An inbound message that produces no reply
   * reads as a broken number to the sender, so the only thing that may stay
   * silent is a sender who has already been answered several times (below),
   * which stops a chatty stranger from turning into a reply loop.
   */
  private async sendUnrecognizedFallback(eventId: string, msg: ExtractedMessageEvent) {
    const phone = msg.from;

    const limit = await rateLimitService.checkStatelessLimit({
      scope: "whatsapp_fallback",
      identifier: phone,
      maxAttempts: 3,
      windowSeconds: 10 * 60,
    });

    if (!limit.allowed) {
      logger.info("whatsapp.webhook.fallback_rate_limited", {
        webhook_event_id: eventId,
        from: phone,
        body_preview: msg.body.slice(0, 80),
      });
      return { phone, channel: "FALLBACK", success: false, reason: "RATE_LIMITED" };
    }

    logger.info("whatsapp.webhook.unrecognized_message", {
      webhook_event_id: eventId,
      from: phone,
      message_type: msg.messageType,
      body_preview: msg.body.slice(0, 80),
    });

    const identity = await resolveSenderIdentity(phone);
    if (identity.residents.length === 0) {
      await new MetaWhatsAppProvider().sendTextMessage(phone, unknownSenderMessage());
      return { phone, channel: "FALLBACK", success: true, reason: "UNKNOWN_SENDER" };
    }

    await commandCenterService.sendUnrecognised(phone, identity);
    return { phone, channel: "FALLBACK", success: true };
  }

  /** A handler blew up. Say so rather than leaving the sender hanging. */
  private async sendErrorNotice(msg: ExtractedMessageEvent) {
    const limit = await rateLimitService.checkStatelessLimit({
      scope: "whatsapp_error_notice",
      identifier: msg.from,
      maxAttempts: 2,
      windowSeconds: 10 * 60,
    });
    if (!limit.allowed) return;

    const provider = new MetaWhatsAppProvider();
    await provider.sendTextMessage(
      msg.from,
      [
        "That request did not go through.",
        "",
        "Nothing was charged and nothing was changed. Please try again in a few minutes, or contact the hostel directly.",
      ].join("\n")
    );
  }

}

function inferEventType(payload: unknown) {
  const webhook = payload as MetaWebhookPayload;
  return webhook.entry?.[0]?.changes?.[0]?.field || null;
}

export const whatsappWebhookEventService = new WhatsAppWebhookEventService();
