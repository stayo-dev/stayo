import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { incrementOtpDeliveryStatus } from "@/lib/metrics";
import { formatDate, formatShortMonth, formatShortDate } from "@/lib/format";
import { financialService } from "@/src/services/payments/financial-service";
import { rateLimitService } from "@/lib/services/rate-limit-service";
import { MetaWhatsAppProvider } from "./providers/whatsapp/meta-provider";
import { ownerWhatsAppAssistantService } from "./owner-whatsapp-assistant";
import {
  setSelectionState,
  deleteSelectionState,
  BalanceSelectionState,
  ResidentContextState,
} from "./whatsapp-selection-state";
import {
  resolveActiveResident,
  setActiveResident,
  refreshResidentContext,
  clearActiveResident,
  ResolvedResident,
} from "./whatsapp-resident-context";
import {
  getNextBillingInfo,
  getPaymentHealth,
} from "./whatsapp-billing-intelligence";
import { formatBalanceResponse } from "./whatsapp-balance-formatter";
import { getFrontendUrl } from "@/lib/config/domains";
import { routeInboundMessage } from "./routing/message-router";
import { resolveSenderIdentity } from "./routing/identity-resolver";
import { INTENTS, defaultIntentResolver } from "./routing/intent-resolvers";
import {
  ANY_ROLE,
  Intent,
  IntentDefinition,
  KNOWN_ROLES,
  PERMISSIONS,
  SenderIdentity,
} from "./routing/types";

const logger = getLogger("whatsapp.webhook-event");

function getPhoneCandidates(rawPhone: string): string[] {
  const digits = rawPhone.replace(/\D/g, "");
  if (!digits) return [];
  const candidates = [digits, rawPhone];
  if (digits.length === 12 && digits.startsWith("91")) {
    const tenDigits = digits.slice(2);
    candidates.push(tenDigits);
    candidates.push(`+91${tenDigits}`);
    candidates.push(`0${tenDigits}`);
  } else if (digits.length === 10) {
    candidates.push(`91${digits}`);
    candidates.push(`+91${digits}`);
    candidates.push(`0${digits}`);
  }
  return Array.from(new Set(candidates));
}

function formatAmountWithoutSymbol(amount: number): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

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
        }
      }
    }
  }

  return events;
}

/**
 * Message types the extractor above deliberately does not handle (media,
 * stickers, reactions, location, template quick-reply `button`, system…).
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

// Command-keyword matching now lives with the intent resolvers; re-exported so
// existing callers/tests keep one import site.
export { resolveCommandKey } from "./routing/intent-resolvers";

/** Shared by HELP and by the unrecognised-message fallback, so they can't drift. */
export function buildHelpText(resident: { residentName: string; residentRoom: string } | null) {
  if (resident) {
    return [
      `Active Resident: ${resident.residentName} (Room ${resident.residentRoom})`,
      "",
      "Available commands:",
      "BAL — Balance summary",
      "DUES — View pending dues",
      "PAY — Pay now",
      "STATUS — Agreement status",
      "SWITCH — Change resident",
      "HELP — Show this menu",
    ].join("\n");
  }

  return [
    "Welcome to Stayo",
    "",
    "Send BAL to view your balance and select a resident.",
    "",
    "After selecting a resident, you can use:",
    "BAL, DUES, PAY, STATUS, SWITCH, HELP",
  ].join("\n");
}

export class WhatsAppWebhookEventService {
  private static readonly COMMAND_HANDLERS: Record<
    string,
    (service: WhatsAppWebhookEventService, msg: ExtractedMessageEvent) => Promise<any>
  > = {
    BAL: (service, msg) => service.handleBalanceCommand(msg),
    BALANCE: (service, msg) => service.handleBalanceCommand(msg),
    SWITCH: (service, msg) => service.handleSwitchCommand(msg),
    DUES: (service, msg) => service.handleDuesCommand(msg),
    PAY: (service, msg) => service.handlePayCommand(msg),
    STATUS: (service, msg) => service.handleStatusCommand(msg),
    HELP: (service, msg) => service.handleHelpCommand(msg),
  };

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

  private async handleBalanceCommand(msg: ExtractedMessageEvent) {
    const phone = msg.from;
    const command = msg.body.trim().toUpperCase();

    // 1. Per-sender Rate Limiting (1 request/minute)
    const rateLimitResult = await rateLimitService.checkStatelessLimit({
      scope: "whatsapp_command:BAL",
      identifier: phone,
      maxAttempts: 1,
      windowSeconds: 60,
    });

    if (!rateLimitResult.allowed) {
      logger.warn("whatsapp.command.rate_limited", { phone });

      const provider = new MetaWhatsAppProvider();
      let providerMessageId: string | null = null;
      let providerResponse: any = null;
      let success = false;
      let errorMsg: string | null = null;

      try {
        const sendResult = await provider.sendTextMessage(
          phone,
          "You are requesting updates too frequently. Please wait 1 minute before sending another request."
        );
        providerMessageId = sendResult.providerMessageId;
        providerResponse = sendResult.raw;
        success = true;
      } catch (err: any) {
        errorMsg = err.message || String(err);
      }

      const auditLog = {
        command,
        sender_role: "UNKNOWN",
        success,
        template_used: "text",
        failure_reason: "Rate limit exceeded" + (errorMsg ? `: ${errorMsg}` : ""),
      };

      await prisma.$executeRaw`
        INSERT INTO whatsapp_logs (
          id,
          phone,
          template,
          template_name,
          status,
          delivery_status,
          attempt_count,
          provider_message_id,
          provider_response,
          error_message
        )
        VALUES (
          gen_random_uuid(),
          ${phone},
          'text',
          'BAL',
          'RATE_LIMITED',
          'RATE_LIMITED',
          1,
          ${providerMessageId},
          ${JSON.stringify(auditLog)}::jsonb,
          ${errorMsg}
        )
      `;

      return { phone, command, success: false, reason: "RATE_LIMITED" };
    }

    // V2: Check for active resident context first — skip selection entirely
    const cachedResident = await resolveActiveResident(phone);
    if (cachedResident) {
      await refreshResidentContext(phone);
      const tenant = await prisma.tenants.findFirst({
        where: { id: cachedResident.residentId, status: { in: ["ACTIVE", "INVITED"] } },
        include: { profiles: true },
      });
      if (tenant) {
        const candidates = getPhoneCandidates(phone);
        let senderRole: "TENANT" | "GUARDIAN" = "TENANT";
        const guardianPhones = tenant.guardian_phone ? getPhoneCandidates(tenant.guardian_phone) : [];
        if (guardianPhones.some((p) => candidates.includes(p))) senderRole = "GUARDIAN";
        return this.sendV2BalanceForTenant(tenant, phone, command, senderRole);
      }
      // Tenant no longer active — clear stale context and continue
      await clearActiveResident(phone);
    }

    // 2. Resolve Phone to Active/Invited Tenants
    const candidates = getPhoneCandidates(phone);
    const matchingTenants = await prisma.tenants.findMany({
      where: {
        OR: [
          { phone_1: { in: candidates } },
          { phone_2: { in: candidates } },
          { phone_3: { in: candidates } },
          { guardian_phone: { in: candidates } },
          {
            profiles: {
              phone: { in: candidates }
            }
          }
        ]
      },
      include: {
        profiles: true,
      }
    });

    // Filter by active status
    const activeTenants = matchingTenants.filter(
      (t) => t.status === "ACTIVE" || t.status === "INVITED"
    );

    // Sort activeTenants alphabetically by name to make the selection list deterministic
    activeTenants.sort((a, b) => {
      const nameA = a.profiles?.name || a.guardian_name || "";
      const nameB = b.profiles?.name || b.guardian_name || "";
      return nameA.localeCompare(nameB);
    });

    // Fail-safe denial for no matches
    if (activeTenants.length === 0) {
      const failureReason = "No active tenant found";

      logger.warn("whatsapp.command.unauthorized", {
        phone,
        reason: failureReason,
        matches_found: activeTenants.length,
      });

      const provider = new MetaWhatsAppProvider();
      let providerMessageId: string | null = null;
      let providerResponse: any = null;
      let success = false;
      let errorMsg: string | null = null;

      try {
        const sendResult = await provider.sendTextMessage(
          phone,
          "Sorry, this number is not linked to an active resident account."
        );
        providerMessageId = sendResult.providerMessageId;
        providerResponse = sendResult.raw;
        success = true;
      } catch (err: any) {
        errorMsg = err.message || String(err);
      }

      const auditLog = {
        command,
        sender_role: "UNKNOWN",
        success,
        template_used: "text",
        failure_reason: failureReason + (errorMsg ? `: ${errorMsg}` : ""),
      };

      await prisma.$executeRaw`
        INSERT INTO whatsapp_logs (
          id,
          phone,
          template,
          template_name,
          status,
          delivery_status,
          attempt_count,
          provider_message_id,
          provider_response,
          error_message
        )
        VALUES (
          gen_random_uuid(),
          ${phone},
          'text',
          'BAL',
          'UNAUTHORIZED',
          'UNAUTHORIZED',
          1,
          ${providerMessageId},
          ${JSON.stringify(auditLog)}::jsonb,
          ${errorMsg}
        )
      `;

      return { phone, command, success: false, reason: "UNAUTHORIZED", matches: activeTenants.length };
    }

    // If multiple active tenants match, trigger interactive selection
    if (activeTenants.length > 1) {
      // Fetch allocations to display room numbers
      const allocations = await prisma.roomAllocation.findMany({
        where: { tenant_id: { in: activeTenants.map((t) => t.id) } },
        orderBy: { created_at: "desc" },
        include: { room: true },
      });

      const roomMap = new Map<string, string>();
      for (const alloc of allocations) {
        if (!roomMap.has(alloc.tenant_id) && alloc.room?.room_no) {
          roomMap.set(alloc.tenant_id, alloc.room.room_no);
        }
      }

      // Save selection state for text fallback (backward compat)
      await setSelectionState(phone, {
        phone,
        action: "BALANCE_SELECTION",
        tenantIds: activeTenants.map((t) => t.id),
      });

      const provider = new MetaWhatsAppProvider();
      let providerMessageId: string | null = null;
      let errorMsg: string | null = null;
      let success = false;

      try {
        const bodyText = "Your number is linked to multiple residents.\n\nSelect a resident:";

        if (activeTenants.length <= 3) {
          // V2: WhatsApp Interactive Buttons (≤3 residents)
          const buttons = activeTenants.map((t) => {
            const name = t.profiles?.name || t.guardian_name || "Resident";
            const roomNo = roomMap.get(t.id);
            const title = roomNo ? `${name}`.slice(0, 20) : name.slice(0, 20);
            return { id: `SELECT_RESIDENT:${t.id}`, title };
          });

          const sendResult = await provider.sendButtonMessage(phone, bodyText, buttons);
          providerMessageId = sendResult.providerMessageId;
        } else {
          // V2: WhatsApp Interactive List (>3 residents)
          const rows = activeTenants.map((t) => {
            const name = t.profiles?.name || t.guardian_name || "Resident";
            const roomNo = roomMap.get(t.id);
            return {
              id: `SELECT_RESIDENT:${t.id}`,
              title: name.slice(0, 24),
              description: roomNo ? `Room ${roomNo}` : undefined,
            };
          });

          const sendResult = await provider.sendListMessage(
            phone,
            bodyText,
            [{ title: "Residents", rows }],
            "Select Resident"
          );
          providerMessageId = sendResult.providerMessageId;
        }
        success = true;
      } catch (err: any) {
        errorMsg = err.message || String(err);
      }

      const auditLog = {
        command,
        sender_role: "GUARDIAN",
        success,
        template_used: "interactive",
        state: "selection_pending",
        failure_reason: errorMsg,
      };

      await prisma.$executeRaw`
        INSERT INTO whatsapp_logs (
          id, phone, template, template_name, status, delivery_status,
          attempt_count, provider_message_id, provider_response, error_message
        )
        VALUES (
          gen_random_uuid(), ${phone}, 'interactive', 'BAL',
          'MULTIPLE_MATCHES', 'SENT', 1, ${providerMessageId},
          ${JSON.stringify(auditLog)}::jsonb, ${errorMsg}
        )
      `;

      return { phone, command, success: true, reason: "MULTIPLE_MATCHES", matches: activeTenants.length };
    }

    // Exactly 1 active tenant — set context and respond
    const tenant = activeTenants[0];

    // Determine sender role (Tenant vs Guardian)
    let senderRole: "TENANT" | "GUARDIAN" = "TENANT";
    const guardianPhones = tenant.guardian_phone ? getPhoneCandidates(tenant.guardian_phone) : [];
    if (guardianPhones.some((p) => candidates.includes(p))) {
      senderRole = "GUARDIAN";
    }

    // Set resident context for future commands
    const allocation = await prisma.roomAllocation.findFirst({
      where: { tenant_id: tenant.id },
      orderBy: { created_at: "desc" },
      include: { room: true },
    });
    await setActiveResident(phone, {
      residentId: tenant.id,
      residentName: tenant.profiles?.name || tenant.guardian_name || "Resident",
      residentRoom: allocation?.room?.room_no || "N/A",
      hostelId: tenant.hostel_id,
      ownerId: tenant.owner_id,
    });

    return this.sendV2BalanceForTenant(tenant, phone, command, senderRole);
  }

  private async sendBalanceTemplateForTenant(
    tenant: any,
    phone: string,
    command: string,
    senderRole: "TENANT" | "GUARDIAN"
  ) {
    let success = false;
    let providerMessageId: string | null = null;
    let errorMsg: string | null = null;

    try {
      const obligations = await prisma.rent_obligations.findMany({
        where: {
          tenant_id: tenant.id,
          status: { not: "WAIVED" },
          is_superseded: false,
        },
        include: {
          payments: {
            select: {
              amount_paid: true,
              payment_date: true,
            }
          }
        }
      });

      const summary = financialService.getTenantPaymentSummary(tenant.id, obligations);

      const nextUnpaid = await prisma.rent_obligations.findFirst({
        where: {
          tenant_id: tenant.id,
          status: { in: ["PENDING", "PARTIAL"] },
          is_superseded: false,
        },
        orderBy: { due_date: "asc" },
      });

      const activeAllocation = await prisma.roomAllocation.findFirst({
        where: {
          tenant_id: tenant.id,
          is_active: true,
          end_date: null,
        }
      });

      const allocation = activeAllocation || await prisma.roomAllocation.findFirst({
        where: { tenant_id: tenant.id },
        orderBy: { created_at: "desc" }
      });

      const tenantName = tenant.profiles?.name || tenant.guardian_name || "Resident";
      const ayStart = allocation
        ? new Date(allocation.start_date).getFullYear().toString()
        : (tenant.joined_on ? new Date(tenant.joined_on).getFullYear().toString() : new Date().getFullYear().toString());

      const ayEnd = allocation?.end_date
        ? new Date(allocation.end_date).getFullYear().toString()
        : (allocation
          ? (new Date(allocation.start_date).getFullYear() + 1).toString()
          : (tenant.joined_on ? (new Date(tenant.joined_on).getFullYear() + 1).toString() : (new Date().getFullYear() + 1).toString()));

      const contractStart = allocation
        ? formatDate(allocation.start_date)
        : (tenant.joined_on ? formatDate(tenant.joined_on) : "N/A");

      const contractEnd = allocation?.end_date
        ? formatDate(allocation.end_date)
        : "N/A";

      const totalContract = formatAmountWithoutSymbol(summary.total_billed);
      const totalPaidStr = formatAmountWithoutSymbol(summary.total_paid);
      const balanceRemaining = formatAmountWithoutSymbol(summary.pending_amount);
      const lastPaymentAmount = formatAmountWithoutSymbol(summary.last_payment_amount);
      const lastPaymentDate = summary.last_paid_at ? formatShortMonth(summary.last_paid_at) : "N/A";
      const nextDueMonth = nextUnpaid ? formatShortMonth(nextUnpaid.due_date) : "N/A";

      const bodyParameters = [
        tenantName,       // {{1}}
        ayStart,          // {{2}}
        ayEnd,            // {{3}}
        contractStart,    // {{4}}
        contractEnd,      // {{5}}
        totalContract,    // {{6}}
        totalPaidStr,     // {{7}}
        balanceRemaining, // {{8}}
        lastPaymentAmount,// {{9}}
        lastPaymentDate,  // {{10}}
        nextDueMonth      // {{11}}
      ];

      const provider = new MetaWhatsAppProvider();
      const sendResult = await provider.sendTemplate({
        to: phone,
        templateName: "rent_balance_summary_v1",
        language: { code: "en" },
        bodyParameters,
      });

      providerMessageId = sendResult.providerMessageId;
      success = true;

      const auditLog = {
        command,
        sender_role: senderRole,
        success: true,
        template_used: "rent_balance_summary_v1",
        failure_reason: null,
      };

      await prisma.$executeRaw`
        INSERT INTO whatsapp_logs (
          id,
          phone,
          template,
          template_name,
          status,
          delivery_status,
          attempt_count,
          provider_message_id,
          provider_response,
          tenant_id,
          owner_id,
          hostel_id
        )
        VALUES (
          gen_random_uuid(),
          ${phone},
          'rent_balance_summary_v1',
          'BAL',
          'SENT',
          'SENT',
          1,
          ${providerMessageId},
          ${JSON.stringify(auditLog)}::jsonb,
          ${tenant.id}::uuid,
          ${tenant.owner_id}::uuid,
          ${tenant.hostel_id}::uuid
        )
      `;

      return { phone, command, success: true, tenant_id: tenant.id };
    } catch (err: any) {
      errorMsg = err.message || String(err);
      logger.error("whatsapp.command.failed", { phone, error: errorMsg });

      const auditLog = {
        command,
        sender_role: senderRole,
        success: false,
        template_used: "rent_balance_summary_v1",
        failure_reason: errorMsg,
      };

      await prisma.$executeRaw`
        INSERT INTO whatsapp_logs (
          id,
          phone,
          template,
          template_name,
          status,
          delivery_status,
          attempt_count,
          provider_response,
          error_message,
          tenant_id,
          owner_id,
          hostel_id
        )
        VALUES (
          gen_random_uuid(),
          ${phone},
          'rent_balance_summary_v1',
          'BAL',
          'FAILED',
          'FAILED',
          1,
          ${JSON.stringify(auditLog)}::jsonb,
          ${errorMsg},
          ${tenant.id}::uuid,
          ${tenant.owner_id}::uuid,
          ${tenant.hostel_id}::uuid
        )
      `;

      throw err;
    }
  }

  private async handleSelectionReply(msg: ExtractedMessageEvent, state: BalanceSelectionState) {
    const phone = msg.from;
    const cleanReply = msg.body.trim().toLowerCase();

    // 1. Check if expired
    if (new Date(state.expiresAt).getTime() < Date.now()) {
      await deleteSelectionState(phone);

      const provider = new MetaWhatsAppProvider();
      let providerMessageId: string | null = null;
      let errorMsg: string | null = null;
      let success = false;

      try {
        const sendResult = await provider.sendTextMessage(
          phone,
          "Selection expired.\n\nSend BAL again to view a payment summary."
        );
        providerMessageId = sendResult.providerMessageId;
        success = true;
      } catch (err: any) {
        errorMsg = err.message || String(err);
      }

      const auditLog = {
        event: "WHATSAPP_BALANCE_SELECTION",
        guardianPhone: phone,
        selectedTenantId: null,
        success: false,
        reason: "expired_selection",
        error: errorMsg,
      };

      await prisma.$executeRaw`
        INSERT INTO whatsapp_logs (
          id,
          phone,
          template,
          template_name,
          status,
          delivery_status,
          attempt_count,
          provider_message_id,
          provider_response,
          error_message
        )
        VALUES (
          gen_random_uuid(),
          ${phone},
          'text',
          'BAL',
          'EXPIRED_SELECTION',
          'SENT',
          1,
          ${providerMessageId},
          ${JSON.stringify(auditLog)}::jsonb,
          ${errorMsg}
        )
      `;

      return { phone, success: false, reason: "EXPIRED_SELECTION" };
    }

    // 2. Fetch tenants and active allocations in the selection list
    const tenants = await prisma.tenants.findMany({
      where: {
        id: { in: state.tenantIds },
        status: { in: ["ACTIVE", "INVITED"] },
      },
      include: {
        profiles: true,
      },
    });

    const allocations = await prisma.roomAllocation.findMany({
      where: {
        tenant_id: { in: state.tenantIds },
      },
      orderBy: {
        created_at: "desc",
      },
      include: {
        room: true,
      },
    });

    const roomMap = new Map<string, string>();
    for (const alloc of allocations) {
      if (!roomMap.has(alloc.tenant_id) && alloc.room?.room_no) {
        roomMap.set(alloc.tenant_id, alloc.room.room_no);
      }
    }

    // 3. Match reply against candidates
    const matchedTenants = tenants.filter((t) => {
      const name = t.profiles?.name || t.guardian_name || "Resident";
      const roomNo = roomMap.get(t.id) || "";
      const primary = name.trim().toLowerCase();
      const secondary = `${name} (room ${roomNo})`.trim().toLowerCase();
      return cleanReply === primary || (roomNo && cleanReply === secondary);
    });

    const provider = new MetaWhatsAppProvider();

    // Case A: Exactly 1 matched tenant
    if (matchedTenants.length === 1) {
      const tenant = matchedTenants[0];
      await deleteSelectionState(phone);

      // Log success audit
      const auditLog = {
        event: "WHATSAPP_BALANCE_SELECTION",
        guardianPhone: phone,
        selectedTenantId: tenant.id,
        success: true,
      };

      await prisma.$executeRaw`
        INSERT INTO whatsapp_logs (
          id,
          phone,
          template,
          template_name,
          status,
          delivery_status,
          attempt_count,
          provider_response,
          tenant_id,
          owner_id,
          hostel_id
        )
        VALUES (
          gen_random_uuid(),
          ${phone},
          'text',
          'BAL',
          'SELECTION_SUCCESS',
          'SENT',
          1,
          ${JSON.stringify(auditLog)}::jsonb,
          ${tenant.id}::uuid,
          ${tenant.owner_id}::uuid,
          ${tenant.hostel_id}::uuid
        )
      `;

      // Determine sender role
      let senderRole: "TENANT" | "GUARDIAN" = "TENANT";
      const candidates = getPhoneCandidates(phone);
      const guardianPhones = tenant.guardian_phone ? getPhoneCandidates(tenant.guardian_phone) : [];
      if (guardianPhones.some((p) => candidates.includes(p))) {
        senderRole = "GUARDIAN";
      }

      return this.sendBalanceTemplateForTenant(tenant, phone, "BAL", senderRole);
    }

    // Case B: Ambiguous matches (multiple tenants share this name/reply)
    if (matchedTenants.length > 1) {
      const options = matchedTenants.map((t) => {
        const name = t.profiles?.name || t.guardian_name || "Resident";
        const roomNo = roomMap.get(t.id) || "No Room";
        return `${name} (Room ${roomNo})`;
      });

      const replyText = `Multiple residents share this name.\n\nReply with:\n\n${options.join("\n\nor\n\n")}`;

      let providerMessageId: string | null = null;
      let errorMsg: string | null = null;
      let success = false;

      try {
        const sendResult = await provider.sendTextMessage(phone, replyText);
        providerMessageId = sendResult.providerMessageId;
        success = true;
      } catch (err: any) {
        errorMsg = err.message || String(err);
      }

      // Save a new pending selection state containing only the ambiguous records
      await setSelectionState(phone, {
        phone,
        action: "BALANCE_SELECTION",
        tenantIds: matchedTenants.map((t) => t.id),
      });

      const auditLog = {
        event: "WHATSAPP_BALANCE_SELECTION",
        guardianPhone: phone,
        selectedTenantId: null,
        success: false,
        reason: "ambiguous_selection",
        error: errorMsg,
      };

      await prisma.$executeRaw`
        INSERT INTO whatsapp_logs (
          id,
          phone,
          template,
          template_name,
          status,
          delivery_status,
          attempt_count,
          provider_message_id,
          provider_response,
          error_message
        )
        VALUES (
          gen_random_uuid(),
          ${phone},
          'text',
          'BAL',
          'AMBIGUOUS_SELECTION',
          'SENT',
          1,
          ${providerMessageId},
          ${JSON.stringify(auditLog)}::jsonb,
          ${errorMsg}
        )
      `;

      return { phone, success: false, reason: "AMBIGUOUS_SELECTION", matches: matchedTenants.length };
    }

    // Case C: Invalid selection (Zero matches)
    const originalLines = tenants
      .map((t, idx) => {
        const name = t.profiles?.name || t.guardian_name || "Resident";
        const roomNo = roomMap.get(t.id);
        return `${idx + 1}. ${name}${roomNo ? ` (Room ${roomNo})` : ""}`;
      })
      .join("\n");

    const replyText = `Resident not found.\n\nReply with one of the following names:\n\n${originalLines}\n\nThis selection expires in 10 minutes.`;

    let providerMessageId: string | null = null;
    let errorMsg: string | null = null;
    let success = false;

    try {
      const sendResult = await provider.sendTextMessage(phone, replyText);
      providerMessageId = sendResult.providerMessageId;
      success = true;
    } catch (err: any) {
      errorMsg = err.message || String(err);
    }

    // We do NOT delete the pending state so they can try again.

    const auditLog = {
      event: "WHATSAPP_BALANCE_SELECTION",
      guardianPhone: phone,
      selectedTenantId: null,
      success: false,
      reason: "invalid_selection",
      error: errorMsg,
    };

    await prisma.$executeRaw`
      INSERT INTO whatsapp_logs (
        id,
        phone,
        template,
        template_name,
        status,
        delivery_status,
        attempt_count,
        provider_message_id,
        provider_response,
        error_message
      )
      VALUES (
        gen_random_uuid(),
        ${phone},
        'text',
        'BAL',
        'INVALID_SELECTION',
        'SENT',
        1,
        ${providerMessageId},
        ${JSON.stringify(auditLog)}::jsonb,
        ${errorMsg}
      )
    `;

    return { phone, success: false, reason: "INVALID_SELECTION" };
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

    if (Number(count || 0) > 0) {
      logger.info("whatsapp.webhook.otp_status_updated", {
        provider_message_id: event.providerMessageId,
        status: event.status,
        updated_otps: Number(count || 0),
      });
    }
  }

  // ─── V2 Balance Response (replaces sendBalanceTemplateForTenant) ───

  private async sendV2BalanceForTenant(
    tenant: any,
    phone: string,
    command: string,
    senderRole: "TENANT" | "GUARDIAN"
  ) {
    let success = false;
    let providerMessageId: string | null = null;
    let errorMsg: string | null = null;

    try {
      const obligations = await prisma.rent_obligations.findMany({
        where: { tenant_id: tenant.id, status: { not: "WAIVED" }, is_superseded: false },
        include: { payments: { select: { amount_paid: true, payment_date: true } } },
      });

      const summary = financialService.getTenantPaymentSummary(tenant.id, obligations);
      const [status, health] = await Promise.all([
        financialService.getTenantFinancialStatus(tenant.id),
        getPaymentHealth(tenant.id),
      ]);

      const activeAllocation = await prisma.roomAllocation.findFirst({
        where: { tenant_id: tenant.id, is_active: true },
        orderBy: { created_at: "desc" },
        include: { room: true },
      });
      const allocation = activeAllocation || await prisma.roomAllocation.findFirst({
        where: { tenant_id: tenant.id },
        orderBy: { created_at: "desc" },
        include: { room: true },
      });

      const tenantName = tenant.profiles?.name || tenant.guardian_name || "Resident";
      const roomNo = allocation?.room?.room_no || "N/A";

      // Check for move-out
      let moveOutDate: Date | null = null;
      if (tenant.status === "ACTIVE") {
        const moveOut = await prisma.move_out_requests.findFirst({
          where: {
            tenant_id: tenant.id,
            status: { notIn: ["COMPLETED", "REJECTED"] }
          },
          orderBy: { created_at: "desc" },
          select: { planned_exit_date: true }
        });
        if (moveOut) moveOutDate = moveOut.planned_exit_date;
      }

      const balanceText = formatBalanceResponse({
        residentName: tenantName,
        roomNumber: roomNo,
        health,
        totalBilled: status.payable_now + status.future_outstanding + summary.total_paid,
        totalPaid: summary.total_paid,
        payableNow: status.payable_now,
        futureOutstanding: status.future_outstanding,
        lastPaymentAmount: summary.last_payment_amount,
        lastPaymentDate: summary.last_paid_at,
        nextGenerationDate: status.next_generation_date,
        nextDueDate: status.next_due_date,
        expectedAmount: status.expected_amount,
        fullySettled: status.fully_settled,
        agreement: {
          startDate: allocation?.start_date || tenant.joined_on || null,
          endDate: allocation?.end_date || null,
          billingFrequency: null,
          moveOutDate,
        },
      });

      const provider = new MetaWhatsAppProvider();
      const sendResult = await provider.sendTextMessage(phone, balanceText);
      providerMessageId = sendResult.providerMessageId;
      success = true;

      // Send quick action buttons
      await this.sendQuickActions(provider, phone);

      const auditLog = {
        command,
        sender_role: senderRole,
        success: true,
        template_used: "v2_balance_text",
        failure_reason: null,
      };

      await prisma.$executeRaw`
        INSERT INTO whatsapp_logs (
          id, phone, template, template_name, status, delivery_status,
          attempt_count, provider_message_id, provider_response,
          tenant_id, owner_id, hostel_id
        )
        VALUES (
          gen_random_uuid(), ${phone}, 'v2_balance_text', 'BAL',
          'SENT', 'SENT', 1, ${providerMessageId},
          ${JSON.stringify(auditLog)}::jsonb,
          ${tenant.id}::uuid, ${tenant.owner_id}::uuid, ${tenant.hostel_id}::uuid
        )
      `;

      return { phone, command, success: true, tenant_id: tenant.id };
    } catch (err: any) {
      errorMsg = err.message || String(err);
      logger.error("whatsapp.command.failed", { phone, error: errorMsg });

      const auditLog = {
        command,
        sender_role: senderRole,
        success: false,
        template_used: "v2_balance_text",
        failure_reason: errorMsg,
      };

      await prisma.$executeRaw`
        INSERT INTO whatsapp_logs (
          id, phone, template, template_name, status, delivery_status,
          attempt_count, provider_response, error_message,
          tenant_id, owner_id, hostel_id
        )
        VALUES (
          gen_random_uuid(), ${phone}, 'v2_balance_text', 'BAL',
          'FAILED', 'FAILED', 1,
          ${JSON.stringify(auditLog)}::jsonb, ${errorMsg},
          ${tenant.id}::uuid, ${tenant.owner_id}::uuid, ${tenant.hostel_id}::uuid
        )
      `;

      throw err;
    }
  }

  // ─── V2 Interactive Reply Handler ───

  private async handleInteractiveReply(msg: ExtractedMessageEvent): Promise<any | null> {
    const phone = msg.from;
    const replyId = msg.body.trim();

    // Handle SELECT_RESIDENT:{tenantId} from buttons/list
    if (replyId.startsWith("SELECT_RESIDENT:")) {
      const tenantId = replyId.replace("SELECT_RESIDENT:", "");
      const tenant = await prisma.tenants.findFirst({
        where: { id: tenantId, status: { in: ["ACTIVE", "INVITED"] } },
        include: { profiles: true },
      });

      if (!tenant) {
        const provider = new MetaWhatsAppProvider();
        await provider.sendTextMessage(phone, "Resident not found or no longer active. Send BAL to try again.");
        return { phone, success: false, reason: "TENANT_NOT_FOUND" };
      }

      // Set resident context
      const allocation = await prisma.roomAllocation.findFirst({
        where: { tenant_id: tenant.id },
        orderBy: { created_at: "desc" },
        include: { room: true },
      });

      await setActiveResident(phone, {
        residentId: tenant.id,
        residentName: tenant.profiles?.name || tenant.guardian_name || "Resident",
        residentRoom: allocation?.room?.room_no || "N/A",
        hostelId: tenant.hostel_id,
        ownerId: tenant.owner_id,
      });

      // Clear old balance selection state
      await deleteSelectionState(phone);
      // Re-set the resident context (deleteSelectionState cleared it)
      await setActiveResident(phone, {
        residentId: tenant.id,
        residentName: tenant.profiles?.name || tenant.guardian_name || "Resident",
        residentRoom: allocation?.room?.room_no || "N/A",
        hostelId: tenant.hostel_id,
        ownerId: tenant.owner_id,
      });

      // Confirm selection
      const provider = new MetaWhatsAppProvider();
      const confirmText = `✅ Active Resident: ${tenant.profiles?.name || tenant.guardian_name || "Resident"} (Room ${allocation?.room?.room_no || "N/A"})\n\nYou can now use:\nBAL — Balance summary\nDUES — View dues\nPAY — Pay now\nSTATUS — Agreement status\nSWITCH — Change resident`;
      await provider.sendTextMessage(phone, confirmText);

      // Determine role and send balance
      const candidates = getPhoneCandidates(phone);
      let senderRole: "TENANT" | "GUARDIAN" = "TENANT";
      const guardianPhones = tenant.guardian_phone ? getPhoneCandidates(tenant.guardian_phone) : [];
      if (guardianPhones.some((p) => candidates.includes(p))) senderRole = "GUARDIAN";

      return this.sendV2BalanceForTenant(tenant, phone, "BAL", senderRole);
    }

    // Handle CMD:* quick action buttons
    if (replyId.startsWith("CMD:")) {
      const cmd = replyId.replace("CMD:", "").toUpperCase();
      const syntheticMsg: ExtractedMessageEvent = {
        ...msg,
        body: cmd,
        messageType: "text",
      };
      const handler = WhatsAppWebhookEventService.COMMAND_HANDLERS[cmd];
      if (handler) return handler(this, syntheticMsg);
    }

    return null;
  }

  // ─── V2 SWITCH Command ───

  private async handleSwitchCommand(msg: ExtractedMessageEvent) {
    const phone = msg.from;
    await clearActiveResident(phone);

    // Re-trigger balance command which will show selection
    return this.handleBalanceCommand(msg);
  }

  // ─── V2 DUES Command ───

  private async handleDuesCommand(msg: ExtractedMessageEvent) {
    const phone = msg.from;
    const resident = await this.resolveResidentOrPromptSelection(phone, "DUES");
    if (!resident) return { phone, command: "DUES", success: false, reason: "NO_CONTEXT" };

    const tenant = await prisma.tenants.findFirst({
      where: { id: resident.residentId, status: { in: ["ACTIVE", "INVITED"] } },
    });
    if (!tenant) {
      await clearActiveResident(phone);
      return { phone, command: "DUES", success: false, reason: "TENANT_NOT_FOUND" };
    }

    const status = await financialService.getTenantFinancialStatus(tenant.id);
    await refreshResidentContext(phone);

    const provider = new MetaWhatsAppProvider();
    if (status.payable_now === 0) {
      if (status.fully_settled) {
        await provider.sendTextMessage(
          phone,
          `✅ ${resident.residentName} (Room ${resident.residentRoom})\n\nFully Settled. No pending dues or future contract obligations!`
        );
      } else {
        const nextGenStr = status.next_generation_date ? formatShortDate(status.next_generation_date) : "N/A";
        const amtStr = status.expected_amount ? `₹${formatAmountWithoutSymbol(status.expected_amount)}` : "TBD";
        await provider.sendTextMessage(
          phone,
          `✅ ${resident.residentName} (Room ${resident.residentRoom})\n\nNo dues payable right now. Next billing of ${amtStr} is scheduled for ${nextGenStr}.`
        );
      }
      await this.sendQuickActions(provider, phone);
      return { phone, command: "DUES", success: true, items: 0 };
    }

    const dues = await financialService.getTenantDues(tenant.id, tenant.owner_id, tenant.hostel_id);
    const lines = [`📋 Dues — ${resident.residentName} (Room ${resident.residentRoom})\n`];
    for (const item of dues.items.slice(0, 10)) {
      const typeLabel = item.type === "RENT" ? "Rent" : item.type === "SECURITY_DEPOSIT" ? "Deposit" : item.type === "MAINTENANCE" ? "Maintenance" : item.type;
      const dueStr = formatShortDate(item.due_date);
      lines.push(`• ${typeLabel} — ₹${formatAmountWithoutSymbol(item.outstanding)} (Due: ${dueStr})`);
    }
    lines.push(`\nTotal Due: ₹${formatAmountWithoutSymbol(dues.total_due)}`);

    await provider.sendTextMessage(phone, lines.join("\n"));
    await this.sendQuickActions(provider, phone);

    return { phone, command: "DUES", success: true, items: dues.items.length };
  }

  // ─── V2 PAY Command ───

  private async handlePayCommand(msg: ExtractedMessageEvent) {
    const phone = msg.from;
    const resident = await this.resolveResidentOrPromptSelection(phone, "PAY");
    if (!resident) return { phone, command: "PAY", success: false, reason: "NO_CONTEXT" };

    const tenant = await prisma.tenants.findFirst({
      where: { id: resident.residentId, status: { in: ["ACTIVE", "INVITED"] } },
    });
    if (!tenant) {
      await clearActiveResident(phone);
      return { phone, command: "PAY", success: false, reason: "TENANT_NOT_FOUND" };
    }

    const status = await financialService.getTenantFinancialStatus(tenant.id);
    await refreshResidentContext(phone);

    const provider = new MetaWhatsAppProvider();

    if (status.payable_now === 0) {
      if (status.fully_settled) {
        await provider.sendTextMessage(
          phone,
          `✅ ${resident.residentName} (Room ${resident.residentRoom})\n\nFully Settled. No payments are outstanding.`
        );
      } else {
        const nextGenStr = status.next_generation_date ? formatShortDate(status.next_generation_date) : "N/A";
        const amtStr = status.expected_amount ? `₹${formatAmountWithoutSymbol(status.expected_amount)}` : "TBD";
        await provider.sendTextMessage(
          phone,
          `✅ ${resident.residentName} (Room ${resident.residentRoom})\n\nNo dues payable right now. Next billing of ${amtStr} is scheduled for ${nextGenStr}.`
        );
      }
      return { phone, command: "PAY", success: true, reason: "NO_DUES" };
    }

    const nextBilling = await getNextBillingInfo(tenant.id);
    if (!nextBilling) {
      await provider.sendTextMessage(phone, `✅ ${resident.residentName} (Room ${resident.residentRoom})\n\nNo pending dues to pay!`);
      return { phone, command: "PAY", success: true, reason: "NO_DUES" };
    }

    // Generate payment link
    let paymentUrl: string | null = null;
    try {
      const token = await prisma.payment_link_tokens.create({
        data: {
          obligation_id: nextBilling.obligationId,
          tenant_id: tenant.id,
          hostel_id: tenant.hostel_id,
          owner_id: tenant.owner_id,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
        select: { token: true },
      });
      const appUrl = getFrontendUrl().replace(/\/+$/, "");
      paymentUrl = `${appUrl}/pay/${token.token}`;
    } catch (err: any) {
      logger.warn("whatsapp.pay.link_generation_failed", { error: err.message });
    }

    const lines = [
      `💳 Secure Payment`,
      ``,
      `Resident: ${resident.residentName} (Room ${resident.residentRoom})`,
      `Amount Due: ₹${formatAmountWithoutSymbol(nextBilling.remainingAmount)}`,
      `Due Date: ${formatShortDate(nextBilling.dueDate)}`,
    ];

    if (paymentUrl) {
      lines.push("", `Pay securely: ${paymentUrl}`);
    }

    await provider.sendTextMessage(phone, lines.join("\n"));
    return { phone, command: "PAY", success: true, tenant_id: tenant.id };
  }

  // ─── V2 STATUS Command ───

  private async handleStatusCommand(msg: ExtractedMessageEvent) {
    const phone = msg.from;
    const resident = await this.resolveResidentOrPromptSelection(phone, "STATUS");
    if (!resident) return { phone, command: "STATUS", success: false, reason: "NO_CONTEXT" };

    const tenant = await prisma.tenants.findFirst({
      where: { id: resident.residentId, status: { in: ["ACTIVE", "INVITED"] } },
    });
    if (!tenant) {
      await clearActiveResident(phone);
      return { phone, command: "STATUS", success: false, reason: "TENANT_NOT_FOUND" };
    }

    const allocation = await prisma.roomAllocation.findFirst({
      where: { tenant_id: tenant.id },
      orderBy: { created_at: "desc" },
      include: { room: true },
    });

    let moveOutDate: Date | null = null;
    const moveOut = await prisma.move_out_requests.findFirst({
      where: {
        tenant_id: tenant.id,
        status: { notIn: ["COMPLETED", "REJECTED"] }
      },
      orderBy: { created_at: "desc" },
      select: { planned_exit_date: true }
    });
    if (moveOut) moveOutDate = moveOut.planned_exit_date;

    const { formatAgreementStatus } = await import("./whatsapp-agreement-formatter");
    const agreement = formatAgreementStatus({
      startDate: allocation?.start_date || tenant.joined_on || null,
      endDate: allocation?.end_date || null,
      billingFrequency: null,
      moveOutDate,
    });

    await refreshResidentContext(phone);
    const provider = new MetaWhatsAppProvider();
    const text = `📄 Agreement Status\n${resident.residentName} (Room ${resident.residentRoom})\n\n${agreement.text}`;
    await provider.sendTextMessage(phone, text);
    await this.sendQuickActions(provider, phone);

    return { phone, command: "STATUS", success: true, tenant_id: tenant.id };
  }

  // ─── V2 HELP Command ───

  private async handleHelpCommand(msg: ExtractedMessageEvent) {
    const phone = msg.from;
    const provider = new MetaWhatsAppProvider();
    const cached = await resolveActiveResident(phone);

    await provider.sendTextMessage(phone, buildHelpText(cached));
    return { phone, command: "HELP", success: true };
  }

  /**
   * The intent table: what each intent is for, and who may invoke it.
   *
   * This is the only place authorization is expressed. Adding a role means
   * adding it to `allowedRoles` here; adding an LLM-resolved intent means
   * adding a row. Neither touches the router.
   */
  private buildIntentRegistry(): Record<string, IntentDefinition> {
    const balanceRoles = KNOWN_ROLES; // anyone we can actually match to records
    return {
      [INTENTS.HELP]: {
        name: INTENTS.HELP,
        description: "Show the list of available commands.",
        allowedRoles: ANY_ROLE,
        handler: ({ message }) => this.handleHelpCommand(message),
      },
      [INTENTS.BALANCE]: {
        name: INTENTS.BALANCE,
        description: "Summarise the resident's balance, prompting for a resident when ambiguous.",
        allowedRoles: balanceRoles,
        requiredPermissions: [PERMISSIONS.BILLING_READ],
        handler: ({ message }) => this.handleBalanceCommand(message),
      },
      [INTENTS.DUES]: {
        name: INTENTS.DUES,
        description: "List the resident's pending dues.",
        allowedRoles: balanceRoles,
        requiredPermissions: [PERMISSIONS.BILLING_READ],
        handler: ({ message }) => this.handleDuesCommand(message),
      },
      [INTENTS.PAY]: {
        name: INTENTS.PAY,
        description: "Send a payment link for the resident's outstanding dues.",
        allowedRoles: balanceRoles,
        requiredPermissions: [PERMISSIONS.PAYMENT_INITIATE],
        handler: ({ message }) => this.handlePayCommand(message),
      },
      [INTENTS.STATUS]: {
        name: INTENTS.STATUS,
        description: "Report the resident's agreement status.",
        allowedRoles: balanceRoles,
        requiredPermissions: [PERMISSIONS.BILLING_READ],
        handler: ({ message }) => this.handleStatusCommand(message),
      },
      [INTENTS.SWITCH]: {
        name: INTENTS.SWITCH,
        description: "Change which resident this phone number is acting for.",
        allowedRoles: balanceRoles,
        requiredPermissions: [PERMISSIONS.RESIDENT_SWITCH],
        handler: ({ message }) => this.handleSwitchCommand(message),
      },
      [INTENTS.INTERACTIVE_REPLY]: {
        name: INTENTS.INTERACTIVE_REPLY,
        description: "Handle a tapped button or list selection.",
        // The payload was minted by a message we sent to this number, so the
        // authorization already happened when we sent it.
        allowedRoles: ANY_ROLE,
        handler: ({ message }) => this.handleInteractiveReply(message),
      },
      [INTENTS.CONTINUE_SELECTION]: {
        name: INTENTS.CONTINUE_SELECTION,
        description: "Continue a pending resident-selection prompt.",
        allowedRoles: ANY_ROLE,
        handler: ({ message, intent }) =>
          this.handleSelectionReply(message, (intent.slots as any)?.state),
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
      [
        "This number isn't linked to a Stayo account yet, so we can't look that up.",
        "",
        "If you're a resident, ask your hostel owner to add this number to your profile.",
        "If you're an owner, send LINK followed by the code from your dashboard.",
      ].join("\n")
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

    const provider = new MetaWhatsAppProvider();
    const cached = await resolveActiveResident(phone);
    const text = [
      "Sorry — I didn't understand that.",
      "",
      buildHelpText(cached),
    ].join("\n");

    await provider.sendTextMessage(phone, text);
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
      "Something went wrong on our side and we couldn't complete that request. Please try again in a few minutes."
    );
  }

  // ─── V2 Quick Actions ───

  private async sendQuickActions(provider: MetaWhatsAppProvider, phone: string) {
    try {
      await provider.sendButtonMessage(
        phone,
        "What would you like to do?",
        [
          { id: "CMD:DUES", title: "View Dues" },
          { id: "CMD:PAY", title: "Pay Now" },
          { id: "CMD:SWITCH", title: "Switch Resident" },
        ]
      );
    } catch (err: any) {
      // Non-critical — log and continue
      logger.warn("whatsapp.quick_actions.failed", { phone, error: err.message });
    }
  }

  // ─── V2 Resident Resolution Helper ───

  private async resolveResidentOrPromptSelection(
    phone: string,
    command: string
  ): Promise<ResolvedResident | null> {
    const cached = await resolveActiveResident(phone);
    if (cached) return cached;

    // No context — prompt them to use BAL first
    const provider = new MetaWhatsAppProvider();
    await provider.sendTextMessage(
      phone,
      `No active resident selected.\n\nSend BAL to select a resident first.`
    );
    return null;
  }
}

function inferEventType(payload: unknown) {
  const webhook = payload as MetaWebhookPayload;
  return webhook.entry?.[0]?.changes?.[0]?.field || null;
}

export const whatsappWebhookEventService = new WhatsAppWebhookEventService();
