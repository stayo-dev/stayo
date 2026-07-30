import crypto from "crypto";
import { prisma } from "../db";

type MaybeHostelId = string | null;

type TransitionInput = {
  attemptId: string;
  fromStatus?: string | null;
  toStatus: string;
  reason?: string;
  source: string;
  actorId?: string | null;
  operationalOwnerId?: string | null;
  financialOwnerId?: string | null;
  hostelId?: MaybeHostelId;
  metadata?: any;
};

class KeyedMutex {
  private locks = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    let unlock: () => void = () => {};
    const currentLock = this.locks.get(key);
    
    const newLock = new Promise<void>((resolve) => {
      unlock = () => {
        if (this.locks.get(key) === newLock) {
          this.locks.delete(key);
        }
        resolve();
      };
    });

    this.locks.set(key, newLock);

    if (currentLock) {
      await currentLock;
    }

    return unlock;
  }
}

export class PaymentStatusEventService {
  private mutex = new KeyedMutex();

  async updateAttemptStatus(tx: any, input: TransitionInput & { data?: any }) {
    const updated = await tx.paymentAttempt.update({
      where: { id: input.attemptId },
      data: {
        ...(input.data || {}),
        status: input.toStatus,
      },
    });
    await this.append(tx, {
      ...input,
      operationalOwnerId: input.operationalOwnerId || updated.owner_id || null,
      financialOwnerId: input.financialOwnerId === undefined ? updated.owner_id || null : input.financialOwnerId,
      hostelId: input.hostelId === undefined ? updated.hostel_id || null : input.hostelId,
    });
    return updated;
  }

  async updateAttemptStatusOutsideTransaction(input: TransitionInput & { data?: any }) {
    return prisma.$transaction((tx) => this.updateAttemptStatus(tx, input));
  }

  async append(tx: any, input: TransitionInput) {
    const unlock = await this.mutex.acquire(input.attemptId);
    try {
      // 1. Transaction-level PG advisory lock to serialize across concurrent processes
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"status_event:" + input.attemptId})::bigint)`;

      // 2. Row-level lock on payment attempts as a fallback
      await tx.$queryRaw`SELECT id FROM payment_attempts WHERE id = ${input.attemptId}::uuid FOR UPDATE`;

      // 3. Query the next sequence using Prisma aggregate for database safety
      const aggregate = await tx.paymentAttemptStatusEvent.aggregate({
        where: { payment_attempt_id: input.attemptId },
        _max: { transition_sequence: true },
      });
      const nextSequence = (aggregate._max.transition_sequence ?? 0) + 1;
      
      // Ensure we ALWAYS get a valid UUID string even if crypto.randomUUID() is stripped/undefined in edge
      const generatedId = (typeof crypto.randomUUID === 'function') 
        ? crypto.randomUUID() 
        : crypto.randomBytes(16).toString("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

      try {
        return await tx.paymentAttemptStatusEvent.create({
          data: {
            id: generatedId,
            payment_attempt_id: input.attemptId,
            transition_sequence: nextSequence,
            from_status: input.fromStatus || null,
            to_status: input.toStatus,
            reason: input.reason || null,
            source: input.source,
            actor_id: input.actorId || null,
            operational_owner_id: input.operationalOwnerId || null,
            financial_owner_id: input.financialOwnerId || null,
            hostel_id: input.hostelId || null,
            metadata: input.metadata || null,
          },
        });
      } catch (err: any) {
        // Handle P2002 Unique constraint violation
        if (err.code === "P2002") {
          const existing = await tx.paymentAttemptStatusEvent.findFirst({
            where: {
              payment_attempt_id: input.attemptId,
              transition_sequence: nextSequence,
            },
          });
          if (existing) {
            return existing;
          }
        }
        throw err;
      }
    } finally {
      unlock();
    }
  }

  async appendOutsideTransaction(input: TransitionInput) {
    return prisma.$transaction((tx) => this.append(tx, input));
  }
}

export const paymentStatusEventService = new PaymentStatusEventService();
