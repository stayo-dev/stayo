export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import {
  handleWhatsAppWebhookEvent,
  handleWhatsAppWebhookVerification,
} from "@/lib/services/notifications/whatsapp-webhook-handler";

/**
 * Legacy mount of the Meta WhatsApp webhook, kept so an app subscription still
 * pointing at this path keeps delivering. The canonical URL is
 * /api/webhooks/whatsapp — both delegate to the same handler, and new Meta
 * configuration should use the canonical one.
 */
export async function GET(req: NextRequest) {
  return handleWhatsAppWebhookVerification(req);
}

export async function POST(req: NextRequest) {
  return handleWhatsAppWebhookEvent(req);
}
