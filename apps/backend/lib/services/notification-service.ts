import { prisma } from "../db";
import { MetaWhatsAppProvider, validateWhatsAppConfiguration } from "./notifications/providers/whatsapp/meta-provider";

// Run startup check if WhatsApp OTP provider is enabled
if (process.env.OTP_PROVIDER === "whatsapp") {
  validateWhatsAppConfiguration();
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

