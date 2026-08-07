export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/auth";
import { LeadLinkEmailSchema } from "@/lib/validators";
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";

/**
 * POST /api/leads/track/[token]/link-email — attach a Google email to a lead
 * that already exists.
 *
 * The conversational capture flow saves the lead at the phone step and only
 * then offers Google, so that abandoning at the Google step still leaves us a
 * usable lead. This is where the optional email lands when they do complete it.
 *
 * Auth is the tracking token, the same bearer secret the public status page
 * uses — the person completing OAuth is the person who just filled in the
 * form, and no session exists for them yet by definition.
 *
 * The email is client-asserted, exactly as it was when `/leads/self-serve`
 * accepted `google_email` directly. It is a contact detail, not a credential:
 * nothing in the funnel grants access based on it, and the activation link is
 * still delivered to the OTP-verified phone.
 *
 * Write-once: a lead that already has an email is left alone, so a leaked
 * tracking link cannot overwrite a captured address.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const validated = LeadLinkEmailSchema.safeParse(body);
    if (!validated.success) {
      return apiError("A valid email is required", "VALIDATION_ERROR", 400);
    }

    const lead = await prisma.platform_leads.findUnique({
      where: { tracking_token: token },
      select: { id: true, google_email: true },
    });
    if (!lead) return apiError("We couldn't find that enquiry.", "NOT_FOUND", 404);

    if (lead.google_email) {
      // Already linked — report success rather than an error, so a double
      // callback (refresh, back button) is harmless.
      return apiResponse({ linked: false, reason: "ALREADY_LINKED" });
    }

    await prisma.platform_leads.update({
      where: { id: lead.id },
      data: { google_email: validated.data.google_email, updated_at: new Date() },
    });

    await eventLog.log("LEAD_EMAIL_LINKED", null, { lead_id: lead.id });

    return apiResponse({ linked: true });
  } catch (error: any) {
    console.error("Detailed API Error [leads.track.link-email]:", error);
    return apiError("Could not save your email.", "INTERNAL_ERROR", 500);
  }
}
