export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import {
  handleWhatsAppWebhookEvent,
  handleWhatsAppWebhookVerification,
} from "@/lib/services/notifications/whatsapp-webhook-handler";

/**
 * Canonical Meta WhatsApp Cloud API webhook.
 *
 * Production URL: https://yourstayo.com/api/webhooks/whatsapp
 * (yourstayo.com is the Vercel frontend, which rewrites /api/:path* to
 * https://api.yourstayo.com — this Next.js backend — see apps/frontend/vercel.json.)
 *
 * Public: Meta calls it server-side, so it is allow-listed in middleware.ts and
 * authenticated by the X-Hub-Signature-256 HMAC instead of a session.
 * The implementation lives in the shared handler; do not add a second one.
 */
export async function GET(req: NextRequest) {
  return handleWhatsAppWebhookVerification(req);
}

export async function POST(req: NextRequest) {
  return handleWhatsAppWebhookEvent(req);
}
