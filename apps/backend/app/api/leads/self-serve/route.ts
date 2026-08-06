export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import crypto from "crypto";
import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/auth";
import { LeadSelfServeSchema } from "@/lib/validators";
import { normalizeWhatsAppPhone } from "@/lib/services/notifications/providers/whatsapp";
import { resolveSignupPhoneVerification } from "@/lib/services/auth/signup-phone-verification-gate";
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { platformLeadNotificationService } from "@/src/services/platform-leads/platform-lead-notification-service";

const OTP_PURPOSE = "LEAD_CAPTURE";

/**
 * Real Google-auth lead-capture flow (landing page "Manage My Hostel" →
 * Google → details + phone OTP). Public route — deliberately does not
 * require a Supabase/StayO session (a brand-new visitor has neither); the
 * security gate is the same one /api/auth/owner-signup already uses: a
 * fresh, phone-OTP-verified record. See lead-capture-google-otp plan.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const validated = LeadSelfServeSchema.safeParse(body);
    if (!validated.success) {
      return apiError("Validation error", "VALIDATION_ERROR", 400);
    }
    const { name, hostel_name, phone, google_email, city, bed_count } = validated.data;

    const normalizedPhone = normalizeWhatsAppPhone(phone);
    const verification = await resolveSignupPhoneVerification(normalizedPhone, OTP_PURPOSE);
    if (!verification.ok) {
      return apiError("Phone verification is required before submitting", "PHONE_NOT_VERIFIED", 400);
    }

    const lead = await prisma.platform_leads.create({
      data: {
        name,
        hostel_name,
        phone: normalizedPhone,
        google_email: google_email || null,
        phone_verified: verification.phoneVerified,
        city: city || null,
        bed_count: bed_count ?? null,
        status: "NEW",
        tracking_token: crypto.randomBytes(32).toString("hex"),
      },
    });

    await eventLog.log("LEAD_CREATED", null, { lead_id: lead.id, hostel_name: lead.hostel_name });

    // Fire-and-forget: a WhatsApp outage must never cost us a captured lead.
    // The tracking link is also shown on the submission success screen, so
    // the applicant is not dependent on this message arriving.
    void platformLeadNotificationService
      .sendLeadReceived({ id: lead.id, name: lead.name, phone: lead.phone, tracking_token: lead.tracking_token })
      .catch((err) => console.error("[leads.self-serve] lead-received notify failed", err));

    return apiResponse({ id: lead.id, status: lead.status, tracking_token: lead.tracking_token }, 201);
  } catch (error: any) {
    console.error("Detailed API Error [leads.self-serve]:", error);
    return apiError("Could not submit your details. Please try again.", "INTERNAL_ERROR", 500);
  }
}
