import { NextRequest, NextResponse } from "next/server";
import {
  resolveAppSecret,
  resolveVerifyToken,
} from "@/lib/services/notifications/whatsapp-webhook-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const configured = process.env.OTP_PROVIDER === "whatsapp";
  const tokenPresent = !!(process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN);
  const phoneNumberIdPresent = !!(process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID);
  const businessAccountIdPresent = !!process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const templateConfigured = !!process.env.WHATSAPP_OTP_TEMPLATE;

  // Presence flags only — never the values themselves.
  const verifyTokenPresent = !!resolveVerifyToken();
  const appSecretPresent = !!resolveAppSecret();
  const appIdPresent = !!process.env.META_APP_ID;

  return NextResponse.json({
    configured,
    tokenPresent,
    phoneNumberIdPresent,
    businessAccountIdPresent,
    templateConfigured,
    webhook: {
      url: "/api/webhooks/whatsapp",
      verifyTokenPresent,
      appSecretPresent,
      appIdPresent,
      ready: verifyTokenPresent && appSecretPresent,
    },
  });
}
