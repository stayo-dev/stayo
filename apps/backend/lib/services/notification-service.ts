import { prisma } from "../db";
import { MetaWhatsAppProvider, validateWhatsAppConfiguration } from "./notifications/providers/whatsapp/meta-provider";
import { shouldPush, pushLinkFor } from "@/src/services/notifications/push/push-policy";
import { sendToProfile } from "@/src/services/notifications/push/push-sender";

// Startup check when the WhatsApp OTP provider is enabled. Deliberately logged
// rather than thrown (2026-07-31, ADR-034): this runs at *module import*, so a
// half-configured environment used to hard-500 every route that transitively
// imports this file — including the signup OTP route, whose whole job is now to
// degrade gracefully when WhatsApp is unavailable. Throwing here fired before
// any of that fallback logic could run. The misconfiguration is still surfaced
// loudly; it just no longer takes the request down with it.
if (process.env.OTP_PROVIDER === "whatsapp") {
  try {
    validateWhatsAppConfiguration();
  } catch (error) {
    console.error(
      "[notification-service] WhatsApp OTP provider is misconfigured — phone verification will degrade to skipped:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export class NotificationService {
  async getUserNotifications(userId: string) {
    return prisma.notifications.findMany({
      where: { profile_id: userId },
      orderBy: { created_at: "desc" },
      take: 50
    });
  }

  async markAsRead(notificationId: string, userId: string) {
    return prisma.notifications.update({
      where: { id: notificationId, profile_id: userId },
      data: { is_read: true }
    });
  }

  async createNotification(userId: string, title: string, message: string, type: string, metadata?: Record<string, unknown>) {
    const normalisedType = type.toLowerCase();

    const notification = await prisma.notifications.create({
      data: {
        profile_id: userId,
        title,
        message,
        type: normalisedType,
        ...(metadata !== undefined ? { metadata } : {})
      }
    });

    /*
     * Push is a *fourth channel on this same event*, which is why it hangs
     * here rather than at 22 call sites: the `type` argument is already the
     * key the policy is indexed by, so one hook covers the whole catalogue and
     * "which events push" stays one reviewable file.
     *
     * Deliberately not awaited and never allowed to reject. This runs on paths
     * that record payments — a push service outage must cost a notification,
     * never the write it belongs to.
     */
    if (shouldPush(normalisedType)) {
      void sendToProfile(userId, {
        title,
        body: message,
        url: pushLinkFor(normalisedType),
      }).catch(() => undefined);
    }

    return notification;
  }

  async sendOtp(input: {
    phone: string;
    otp: string;
    purpose: string;
    /** OTP record id, threaded through so delivery logs join the lifecycle. */
    correlationId?: string;
  }) {
    const provider = process.env.OTP_PROVIDER;
    if (provider === "whatsapp") {
      const whatsappProvider = new MetaWhatsAppProvider();
      return whatsappProvider.sendOtp({
        to: input.phone,
        otp: input.otp,
        purpose: input.purpose,
        correlationId: input.correlationId,
      });
    }

    if (provider === "sms" || provider === "email") {
      throw new Error(`CRITICAL CONFIGURATION ERROR: OTP delivery channel '${provider}' is not implemented/configured.`);
    }

    throw new Error(`CRITICAL CONFIGURATION ERROR: Invalid or unconfigured OTP_PROVIDER: '${provider}'`);
  }
}

export const notificationService = new NotificationService();

