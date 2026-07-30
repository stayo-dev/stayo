import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { MetaWhatsAppProvider } from "@/lib/services/notifications/providers/whatsapp/meta-provider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["ADMIN"].includes(session.role)) {
    return apiError("Unauthorized: Admin access required", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json();
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";

    if (!phone) {
      return apiError("phone is required", "VALIDATION_ERROR", 400);
    }

    const whatsappProvider = new MetaWhatsAppProvider();
    const result = await whatsappProvider.sendOtp({
      to: phone,
      otp: "123456",
      purpose: "TEST",
    });

    return apiResponse({
      success: true,
      messageId: result.providerMessageId,
      provider: "whatsapp",
    });
  } catch (error: any) {
    return apiError(
      error?.message || "Failed to send test OTP",
      error?.code || "TEST_OTP_FAILED",
      500
    );
  }
}
