export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/auth";
import { LeadSelfServeSchema } from "@/lib/validators";
import { normalizeWhatsAppPhone } from "@/lib/services/notifications/providers/whatsapp";
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";

const OTP_PURPOSE = "LEAD_CAPTURE";
const OTP_FRESHNESS_MS = 30 * 60 * 1000;

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
    const verifiedOtp = await (prisma as any).phoneVerificationOtp.findFirst({
      where: { phone: normalizedPhone, purpose: OTP_PURPOSE, status: "VERIFIED" },
      orderBy: { created_at: "desc" },
    });
    const verifiedRecently =
      verifiedOtp?.verified_at && Date.now() - new Date(verifiedOtp.verified_at).getTime() < OTP_FRESHNESS_MS;
    if (!verifiedRecently) {
      return apiError("Phone verification is required before submitting", "PHONE_NOT_VERIFIED", 400);
    }

    const lead = await prisma.platform_leads.create({
      data: {
        name,
        hostel_name,
        phone: normalizedPhone,
        google_email: google_email || null,
        city: city || null,
        bed_count: bed_count ?? null,
        status: "NEW",
      },
    });

    await eventLog.log("LEAD_CREATED", null, { lead_id: lead.id, hostel_name: lead.hostel_name });

    return apiResponse({ id: lead.id, status: lead.status }, 201);
  } catch (error: any) {
    console.error("Detailed API Error [leads.self-serve]:", error);
    return apiError("Could not submit your details. Please try again.", "INTERNAL_ERROR", 500);
  }
}
