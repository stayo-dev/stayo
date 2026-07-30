export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse } from "@/lib/auth";
import { getLogger } from "@/lib/logger";
import { authOtpService, OtpServiceError } from "@/lib/services/auth/auth-otp-service";
import { SendPhoneOtpSchema } from "@/lib/validators/otp";

const logger = getLogger("api.auth.send-phone-otp");

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const validated = SendPhoneOtpSchema.safeParse(body);
    if (!validated.success) {
      return apiError("Invalid phone number", "VALIDATION_ERROR", 400);
    }

    const result = await authOtpService.sendPhoneOtp({
      phone: validated.data.phone,
      purpose: validated.data.purpose,
      requestIp: getRequestIp(req),
    });

    return apiResponse({
      success: true,
      expires_in_seconds: result.expires_in_seconds,
    });
  } catch (error: any) {
    if (error instanceof OtpServiceError) {
      return apiError(error.message, error.code, error.status);
    }

    logger.error("send_phone_otp.failed", {
      error: error?.message || String(error),
    });
    return apiError("Failed to send OTP", "OTP_SEND_FAILED", 500);
  }
}

function getRequestIp(req: NextRequest) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip") || null;
}
