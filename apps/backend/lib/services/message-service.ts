import { prisma } from "../db";
import { getLogger } from "../logger";

const logger = getLogger("message-service");

export class MessageService {
  /**
   * Send a single message via a channel and deduct 1 credit atomically.
   * Throws if no credits available. Uses a robust reservation flow.
   */
  async sendMessage(ownerId: string, channel: string, recipient: string, template: string, body: string, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await (prisma as any).messageLog.findUnique({ where: { idempotency_key: idempotencyKey } });
      if (existing) {
        logger.info(`[message-service] Idempotency hit for key ${idempotencyKey}`);
        return { success: existing.success, remaining: await this.getCredits(ownerId), logId: existing.id };
      }
    }

    const total = await (prisma as any).messagePack.aggregate({ _sum: { messages_remaining: true }, where: { owner_id: ownerId } });
    const credits = Number(total._sum.messages_remaining || 0);
    if (credits <= 0) throw new Error("FORBIDDEN: Message quota exhausted");

    const res = await prisma.$transaction(async (tx) => {
      // Find oldest pack with credits
      const packs = await (tx as any).message_packs.findMany({ where: { owner_id: ownerId, messages_remaining: { gt: 0 } }, orderBy: { purchased_at: "asc" }, take: 1 });
      if (!packs || packs.length === 0) throw new Error("FORBIDDEN: Message quota exhausted");
      
      const usedPackId = packs[0].id;

      // ATOMIC UPDATE to lock in decrement
      const updateResult = await (tx as any).message_packs.updateMany({
        where: { id: usedPackId, messages_remaining: { gt: 0 } },
        data: { messages_remaining: { decrement: 1 } }
      });

      if (updateResult.count === 0) {
         throw new Error("FORBIDDEN: Message quota exhausted during atomic lock.");
      }

      const id = require("crypto").randomUUID();
      await (tx as any).message_logs.create({
        data: { 
          id, owner_id: ownerId, channel, template, recipient, 
          success: null, status: "RESERVED", deduction: 1, pack_id: usedPackId,
          idempotency_key: idempotencyKey
        } 
      });
      
      return { logId: id, usedPackId, remaining: credits - 1 };
    });

    try {
      // This service only owns legacy quota reservation. Provider-specific
      // delivery must happen through a real provider integration; never mark a
      // message successful from this generic path.
      throw new Error(`UNSUPPORTED_PROVIDER_CHANNEL: ${channel} delivery is not configured in message-service`);
    } catch (error) {
       logger.error(`Message send failed for owner ${ownerId}, issuing refund.`);

       await prisma.$transaction(async (tx) => {
           await (tx as any).message_packs.update({
               where: { id: res.usedPackId },
               data: { messages_remaining: { increment: 1 } }
           });
           await (tx as any).message_logs.update({
               where: { id: res.logId },
               data: { success: false, status: "FAILED", provider_response: (error as Error).message }
           });
       });
       throw error;
    }
  }

  async getCredits(ownerId: string) {
    const total = await (prisma as any).messagePack.aggregate({ _sum: { messages_remaining: true }, where: { owner_id: ownerId } });
    return Number(total._sum.messages_remaining || 0);
  }
}

export const messageService = new MessageService();
