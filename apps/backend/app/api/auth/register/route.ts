export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiResponse, apiError, getSession } from "@/lib/auth";
import { authService } from "@/lib/services/auth-service";
import { RegisterSchema } from "@/lib/validators";
import { normalizeIndianPhone } from "@/lib/utils/phone-utils";
import { verifyIdentityToken } from "@/lib/auth-edge";
import { prisma } from "@/lib/db";

const OTP_PURPOSE = "PHONE_VERIFICATION";
const OTP_ACTION  = "registration";

/**
 * 📝 AUTH REGISTER — Owner Registration (MSG91 Edition)
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Owner self-registration is disabled. Contact your administrator.", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json();
    const validated = RegisterSchema.safeParse(body);

    if (!validated.success) {
      return apiError("Validation error", "VALIDATION_ERROR", 400);
    }

    const normalizedPhone = normalizeIndianPhone(validated.data.phone);
    if (!normalizedPhone) {
      return apiError("Valid Indian mobile number is required", "VALIDATION_ERROR", 400);
    }

    // ── Verify MSG91 flow token ─────────────────────────────────────────────
    const verificationToken = (body as any).verification_token;
    if (!verificationToken) {
      return apiError("Phone verification is required", "UNAUTHORIZED", 401);
    }

    const payload = await verifyIdentityToken(verificationToken, OTP_PURPOSE, OTP_ACTION);
    if (!payload || payload.userId !== normalizedPhone) {
      return apiError("Invalid or expired verification token", "UNAUTHORIZED", 401);
    }

    // Check if JTI was already used (single-use token)
    const tokenRecord = await prisma.identity_tokens.findUnique({
      where: { jti: payload.jti }
    });

    if (!tokenRecord || tokenRecord.used) {
      return apiError("Verification token already used", "UNAUTHORIZED", 401);
    }

    // Mark token as used
    await prisma.identity_tokens.update({
      where: { jti: payload.jti },
      data: { used: true }
    });

    // ── Create Account ──────────────────────────────────────────────────────
    const profile = await authService.registerOwner({
      ...validated.data,
      phone: normalizedPhone,
      mobile_verified: true,
    });

    return apiResponse(profile, 201);
  } catch (error: any) {
    if (error.message.startsWith("ALREADY_EXISTS"))
      return apiError(error.message.split(": ")[1], "ALREADY_EXISTS", 400);
    if (error.message.startsWith("INTERNAL"))
      return apiError(error.message.split(": ")[1], "INTERNAL_ERROR", 500);
    return apiError(error.message || "Registration failed");
  }
}
