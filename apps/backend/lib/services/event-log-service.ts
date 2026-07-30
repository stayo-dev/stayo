import { prisma } from "../db";
import crypto from "crypto";

/**
 * 📝 System Event Logger
 * 
 * Central audit trail for all automated actions.
 * This is the observability backbone — without it,
 * debugging production issues requires log scraping.
 * 
 * Usage:
 *   await eventLog.log("RENT_GENERATED", ownerId, { count: 5, month: "2026-05" });
 *   await eventLog.log("LATE_FEE_APPLIED", ownerId, { tenantId, amount: 200 });
 */
class EventLogService {
  async log(
    eventType: string,
    ownerId?: string | null,
    metadata?: Record<string, any>,
    tenantId?: string | null
  ) {
    try {
      await (prisma as any).systemEventLog.create({
        data: {
          id: crypto.randomUUID(),
          event_type: eventType,
          owner_id: ownerId || null,
          tenant_id: tenantId || null,
          metadata: metadata || null,
        }
      });
    } catch (err) {
      // Never let logging failures crash the main pipeline
      console.error(`[EVENT_LOG] Failed to write event ${eventType}:`, err);
    }
  }

  /**
   * Fetch recent events for an owner (for debug dashboard)
   */
  async getRecentEvents(ownerId: string, limit: number = 50) {
    return (prisma as any).systemEventLog.findMany({
      where: { owner_id: ownerId },
      orderBy: { created_at: "desc" },
      take: limit,
    });
  }
}

export const eventLog = new EventLogService();
