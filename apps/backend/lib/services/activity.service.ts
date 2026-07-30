import { prisma } from "../db";
import crypto from "crypto";

export interface LogEntry {
  userId: string;
  ownerId?: string | null;
  actionType: string;
  entityType: string;
  entityId?: string | null;
  metadata?: any;
}

export class ActivityService {
  async log(entry: LogEntry) {
    try {
      await prisma.activity_logs.create({
        data: {
          id: crypto.randomUUID(),
          user_id: entry.userId,
          owner_id: entry.ownerId,
          action_type: entry.actionType,
          entity_type: entry.entityType,
          entity_id: entry.entityId,
          metadata: entry.metadata || {},
        },
      });
    } catch (error) {
      console.error("Activity logging failed:", error);
    }
  }
}

export const activityService = new ActivityService();
