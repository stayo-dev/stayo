import { getLogger } from "@/lib/logger";
import {
  Intent,
  IntentDefinition,
  IntentResolver,
  InboundMessage,
  RouteOutcome,
  SenderIdentity,
  hasPermission,
  isHandled,
  meetsConfidenceFloor,
} from "./types";

const logger = getLogger("whatsapp.router");

export type RouterDeps = {
  resolveIdentity: (phone: string) => Promise<SenderIdentity>;
  intentResolver: IntentResolver;
  registry: Record<string, IntentDefinition>;
  /** Nothing understood the message. Must reply — silence is never an outcome. */
  onFallback: (ctx: { message: InboundMessage; identity: SenderIdentity; candidates: Intent[] }) => Promise<unknown>;
  /** Understood, but this sender may not do it. Must also reply. */
  onDenied: (ctx: { message: InboundMessage; identity: SenderIdentity; intent: Intent }) => Promise<unknown>;
  /** A handler threw. Must also reply. */
  onError: (ctx: { message: InboundMessage; identity: SenderIdentity; error: unknown }) => Promise<unknown>;
  correlationId?: string;
};

/**
 * Route one inbound message: identity → intent candidates → permission → handler.
 *
 * Two properties this is built to guarantee:
 *
 * 1. **Intent first, authorization second.** Nothing is refused before we know
 *    what was asked, which is what the old owner-assistant-at-the-top design
 *    got wrong — an unlinked phone was gated out before anyone looked at
 *    whether it had sent a perfectly ordinary tenant command.
 * 2. **Never silence.** Every path ends in a handler result, a denial message,
 *    an error notice, or the fallback.
 */
export async function routeInboundMessage(
  message: InboundMessage,
  deps: RouterDeps
): Promise<RouteOutcome> {
  const identity = await deps.resolveIdentity(message.from);
  const candidates = await deps.intentResolver.resolve({ message, identity });

  logger.info("whatsapp.router.resolved", {
    correlation_id: deps.correlationId || null,
    from: message.from,
    role: identity.role,
    roles: identity.roles,
    candidates: candidates.map((intent) => `${intent.name}:${intent.source}`),
    body_preview: message.body.slice(0, 80),
  });

  let denied: Intent | null = null;

  for (const intent of candidates) {
    const definition = deps.registry[intent.name];
    if (!definition) {
      logger.warn("whatsapp.router.unregistered_intent", {
        correlation_id: deps.correlationId || null,
        intent: intent.name,
      });
      continue;
    }

    if (!meetsConfidenceFloor(intent, definition)) {
      // Not a permission problem — we simply aren't sure enough to act on
      // something consequential. Try the next candidate, then the fallback.
      logger.info("whatsapp.router.intent_below_confidence_floor", {
        correlation_id: deps.correlationId || null,
        intent: intent.name,
        confidence: intent.confidence,
        min_confidence: definition.minConfidence,
        source: intent.source,
      });
      continue;
    }

    if (!hasPermission(identity, definition)) {
      // Remembered, not acted on yet: a later candidate may still be allowed,
      // and telling someone "you can't do that" when we then do something else
      // for them would be nonsense.
      denied = denied || intent;
      logger.info("whatsapp.router.intent_denied", {
        correlation_id: deps.correlationId || null,
        intent: intent.name,
        role: identity.role,
        allowed_roles: definition.allowedRoles,
        required_permissions: definition.requiredPermissions || [],
        held_permissions: identity.permissions,
      });
      continue;
    }

    try {
      const result = await definition.handler({ message, identity, intent });

      if (!isHandled(result)) {
        // The handler looked and passed — try the next candidate.
        logger.info("whatsapp.router.intent_declined", {
          correlation_id: deps.correlationId || null,
          intent: intent.name,
        });
        continue;
      }

      logger.info("whatsapp.router.intent_handled", {
        correlation_id: deps.correlationId || null,
        intent: intent.name,
        source: intent.source,
        role: identity.role,
      });
      return { status: "HANDLED", identity, intent, candidates, result };
    } catch (error: any) {
      logger.error("whatsapp.router.intent_failed", {
        correlation_id: deps.correlationId || null,
        intent: intent.name,
        role: identity.role,
        error: error?.message || String(error),
      });
      await deps.onError({ message, identity, error }).catch(() => {});
      return {
        status: "FAILED",
        identity,
        intent,
        candidates,
        error: error?.message || String(error),
      };
    }
  }

  if (denied) {
    const result = await deps.onDenied({ message, identity, intent: denied });
    return { status: "DENIED", identity, intent: denied, candidates, result };
  }

  const result = await deps.onFallback({ message, identity, candidates });
  return { status: "FALLBACK", identity, intent: null, candidates, result };
}
