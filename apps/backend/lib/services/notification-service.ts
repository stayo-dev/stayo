import { prisma } from "../db";
import { MetaWhatsAppProvider, validateWhatsAppConfiguration } from "./notifications/providers/whatsapp/meta-provider";

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

  async createNotification(userId: string, title: string, message: string, type: string) {
    return prisma.notifications.create({
      data: {
        profile_id: userId,
        title,
        message,
        type: type.toLowerCase()
      }
    });
  }

  async sendOtp(input: { phone: string; otp: string; purpose: string }) {
    const provider = process.env.OTP_PROVIDER;
    if (provider === "whatsapp") {
      const whatsappProvider = new MetaWhatsAppProvider();
      return whatsappProvider.sendOtp({
        to: input.phone,
        otp: input.otp,
        purpose: input.purpose,
      });
    }

    if (provider === "sms" || provider === "email") {
      throw new Error(`CRITICAL CONFIGURATION ERROR: OTP delivery channel '${provider}' is not implemented/configured.`);
    }

    throw new Error(`CRITICAL CONFIGURATION ERROR: Invalid or unconfigured OTP_PROVIDER: '${provider}'`);
  }
}

export const notificationService = new NotificationService();

