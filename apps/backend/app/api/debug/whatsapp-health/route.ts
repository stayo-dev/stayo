import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const configured = process.env.OTP_PROVIDER === "whatsapp";
  const tokenPresent = !!(process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN);
  const phoneNumberIdPresent = !!(process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID);
  const businessAccountIdPresent = !!process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const templateConfigured = !!process.env.WHATSAPP_OTP_TEMPLATE;

  return NextResponse.json({
    configured,
    tokenPresent,
    phoneNumberIdPresent,
    businessAccountIdPresent,
    templateConfigured,
  });
}
