import { v4 as uuidv4 } from "uuid";
import { getLogger } from "../../../lib/logger";

const logger = getLogger("domain-events");

export interface DomainEvent<TPayload = any> {
  id: string;
  name: string;
  timestamp: Date;
  correlationId: string;
  payload: TPayload;
}

export type EventHandler<T = any> = (event: DomainEvent<T>) => void | Promise<void>;

class DomainEventsBus {
  private handlers = new Map<string, Set<EventHandler>>();

  subscribe<T = any>(eventName: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, new Set());
    }
    this.handlers.get(eventName)!.add(handler);
    return () => {
      this.handlers.get(eventName)?.delete(handler);
    };
  }

  async publish<T = any>(eventName: string, payload: T, correlationId?: string): Promise<void> {
    const event: DomainEvent<T> = {
      id: uuidv4(),
      name: eventName,
      timestamp: new Date(),
      correlationId: correlationId || uuidv4(),
      payload,
    };

    const eventHandlers = this.handlers.get(eventName);
    if (!eventHandlers || eventHandlers.size === 0) {
      logger.info("no_handlers_registered", { eventName });
      return;
    }

    const promises = Array.from(eventHandlers).map(async (handler) => {
      try {
        await handler(event);
      } catch (err: any) {
        logger.error("event_handler_failed", {
          eventName,
          eventId: event.id,
          correlationId: event.correlationId,
          error: err?.message || err,
        });
      }
    });

    await Promise.all(promises);
  }
}

export const domainEventsBus = new DomainEventsBus();
